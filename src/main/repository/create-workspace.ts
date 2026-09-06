import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { joinBranchName } from '../../shared/branch-name.ts';
import { bareBranchName } from '../../shared/branch-ref.ts';
import type { GitSettings } from '../../shared/config.ts';
import type {
	SettingsResolutionRequest,
	SettingsResolutionSnapshot,
} from '../../shared/ipc/contracts/settings-resolution';
import type {
	CreatedWorkspaceSnapshot,
	CreateWorkspaceDiagnostic,
	CreateWorkspaceDiagnosticCode,
	CreateWorkspaceRequest,
	CreateWorkspaceResult,
	FilesToCopySnapshot,
	WorkspaceBranchPlan,
	WorkspaceLinkedIssueInput,
} from '../../shared/ipc/contracts/workspace';
import { pickComposerSurname } from '../../shared/workspace-name-pool.ts';
import type { LocalCommandService } from '../commands/local-command';
import type {
	LoadedRepositoryConfig,
	LoadRepositoryConfigOptions,
} from '../config';
import { loadRepositoryConfig } from '../config/repository-config.ts';
import type { EnsemblrRootDirectoryService } from '../root';
import type { EnsemblrDatabaseService } from '../storage';
import { parseMetadata } from '../storage/repositories/metadata-json.ts';
import { selectRepositoryWithDefaultsById } from '../storage/repositories/repository-row-repository.ts';
import {
	insertWorkspaceRow as insertWorkspaceRowStorage,
	listActiveWorkspaceSnapshotRowsByRepository,
	listWorkspaceNameSlugRowsByRepository,
	workspaceSlugExists as workspaceSlugExistsStorage,
} from '../storage/repositories/workspace-repository.ts';
import { withTransaction } from '../storage/tx.ts';
import {
	createFilesToCopyService,
	type FilesToCopyService,
} from './files-to-copy.ts';
import {
	DEFAULT_FALLBACK_BRANCH,
	ensureBaseRefAvailable,
	GIT_WORKTREE_TIMEOUT_MS,
	listLocalBranchNames,
	refResolvesToCommit,
	resolveRootBranch,
	runBranchDelete,
} from './git-ops.ts';
import type { GithubUsernameResolver } from './github-username.ts';
import { toSlug } from './slug.ts';
import { type GitRefRejection, validateGitRef } from './validate-git-ref.ts';
import { validateWorkspaceName } from './workspace-validation.ts';
import {
	cleanupWorkspaceDirectory,
	createWorktree,
	isSamePath,
} from './worktree-placement.ts';

/** Public surface of the workspace creation service. */
export interface CreateWorkspaceService {
	create: (request: CreateWorkspaceRequest) => Promise<CreateWorkspaceResult>;
}

/** Options for {@link createWorkspaceService}. */
export interface CreateWorkspaceServiceOptions {
	databaseService: EnsemblrDatabaseService;
	filesToCopyService?: FilesToCopyService;
	/**
	 * Resolves the authenticated GitHub login for the `github-username`
	 * branch-prefix source. Omitted in tests (and when no user defaults are
	 * wired), in which case that source resolves to no prefix.
	 */
	githubUsernameResolver?: GithubUsernameResolver;
	loadConfig?: (options: LoadRepositoryConfigOptions) => LoadedRepositoryConfig;
	localCommandService: LocalCommandService;
	now?: () => Date;
	/**
	 * Reads the user-scope git defaults (`app.git`). When omitted, branch-prefix
	 * resolution falls back to the repository config only (legacy behavior).
	 */
	readGitDefaults?: () => GitSettings;
	/**
	 * Resolves the effective repository settings so the configured `branchFrom`
	 * can pick the base branch for new workspaces. When omitted (e.g. in tests),
	 * base selection falls back to the live repository root branch.
	 */
	readRepositorySettings?: (
		request: SettingsResolutionRequest,
	) => SettingsResolutionSnapshot;
	rootDirectoryService: EnsemblrRootDirectoryService;
}

/** Internal: source repository row loaded from SQLite. */
interface SourceRepository {
	defaultBranch: string | null;
	id: string;
	path: string;
	slug: string;
}

/**
 * Internal: the two refs a new workspace needs, kept apart because they answer
 * different questions. `baseBranch` is the merge target the workspace is
 * measured against forever; the fork point is consumed once by
 * `git worktree add` and then lives in the branch's own history.
 */
interface WorkspaceBranchPoint {
	/** Merge target: diff base, conflict probe, and pull-request base. */
	baseBranch: string;
	/** Raised when a configured `branchFrom` had to be abandoned for the fallback. */
	diagnostic?: CreateWorkspaceDiagnostic;
	plan: WorkspaceBranchPlan;
}

/** Internal: validated request plus derived placement fields. */
interface PreparedWorkspace {
	baseBranch: string;
	branchName: string;
	id: string;
	name: string;
	parentDirectory: string;
	path: string;
	/** How `branchName` comes into being: adopted from an existing branch, or cut. */
	plan: WorkspaceBranchPlan;
	repository: SourceRepository;
	slug: string;
}

/**
 * Reads the repo's configured `branchFrom` base from resolved settings, or
 * `undefined` when unset/unavailable so base selection falls back to the live
 * repository root branch.
 * @param resolved - Resolved settings snapshot, when available.
 * @returns The configured base branch, or `undefined`.
 */
function resolveConfiguredBranchFrom(
	resolved: SettingsResolutionSnapshot | undefined,
): string | undefined {
	const value = resolved?.repository?.settings.find(
		(setting) => setting.key === 'branchFrom',
	)?.value;

	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Resolves both refs a new workspace needs, keeping the merge target separate
 * from the fork point so the review panel never diffs a branch against itself.
 * @param options - The request's branch plan, configured base, and git deps.
 * @returns The workspace's merge target plus either an adopted branch or a fork
 * point.
 */
async function resolveBranchPoint({
	configuredBase,
	localCommandService,
	repository,
	request,
}: {
	configuredBase: string | undefined;
	localCommandService: LocalCommandService;
	repository: SourceRepository;
	request: CreateWorkspaceRequest;
}): Promise<WorkspaceBranchPoint> {
	const plan = request.branchPlan ?? { kind: 'create' };
	const { baseBranch, diagnostic } = await resolveBaseBranch({
		adoptedBranch: plan.kind === 'adopt' ? plan.branch.trim() : null,
		configuredBase,
		explicitBase: request.baseBranch?.trim(),
		localCommandService,
		repository,
	});
	const raised = diagnostic ? { diagnostic } : {};
	if (plan.kind === 'adopt') {
		return {
			baseBranch,
			...raised,
			plan: { branch: plan.branch.trim(), kind: 'adopt' },
		};
	}
	return {
		baseBranch,
		...raised,
		plan: { forkRef: plan.forkRef?.trim() || baseBranch, kind: 'create' },
	};
}

/**
 * Chooses the branch a new workspace merges into. An explicit request base wins
 * untouched; a configured personal `branchFrom` is honored only while it still
 * resolves in the repository, so a base that was deleted or renamed never blocks
 * every workspace creation with `git-worktree-failed`. Otherwise creation falls
 * back to the live repository root branch, resolved fresh so a stale stored
 * `default_branch` cannot pin the workspace to the wrong target.
 *
 * The configured base is fetched before it is probed, the same way changing a
 * workspace's target branch already does. The Git settings picker lists a
 * repository's branches from GitHub rather than from local refs, so it can hand
 * back an `origin/<name>` this clone has never fetched — and without the fetch
 * that selection is silently discarded and every workspace comes off the root
 * branch instead. That fetch is also why the configured base is validated here
 * rather than left to the worktree placement's own check: the setting is stored
 * verbatim and can come from a repository's committed settings file, and
 * `ensureBaseRefAvailable` would hand it straight to `git fetch`.
 *
 * A candidate naming the branch the workspace is adopting is skipped: measuring
 * a branch against itself puts the merge-base on HEAD, which empties the review
 * panel of the very commits the workspace was opened to review. That retarget is
 * deliberate, so it is not reported as a problem; a base that was abandoned is,
 * because the setting silently doing nothing is indistinguishable from the app
 * ignoring it.
 * @param options - The adopted branch, explicit/configured bases, and git deps.
 * @returns The resolved merge target, plus a diagnostic when a configured base
 * was abandoned.
 */
async function resolveBaseBranch({
	adoptedBranch,
	configuredBase,
	explicitBase,
	localCommandService,
	repository,
}: {
	adoptedBranch: string | null;
	configuredBase: string | undefined;
	explicitBase: string | undefined;
	localCommandService: LocalCommandService;
	repository: SourceRepository;
}): Promise<{ baseBranch: string; diagnostic?: CreateWorkspaceDiagnostic }> {
	const wouldSelfDiff = (candidate: string): boolean =>
		adoptedBranch !== null &&
		bareBranchName(candidate) === bareBranchName(adoptedBranch);

	if (explicitBase && !wouldSelfDiff(explicitBase)) {
		return { baseBranch: explicitBase };
	}

	const candidateBase =
		configuredBase && !wouldSelfDiff(configuredBase) ? configuredBase : null;
	const rejection = candidateBase ? validateGitRef(candidateBase) : null;

	if (candidateBase && !rejection) {
		await ensureBaseRefAvailable({
			baseBranch: candidateBase,
			localCommandService,
			repositoryPath: repository.path,
		});
		if (
			await refResolvesToCommit({
				localCommandService,
				ref: candidateBase,
				repositoryPath: repository.path,
			})
		) {
			return { baseBranch: candidateBase };
		}
	}

	const fallbackBranch =
		(await resolveRootBranch({
			localCommandService,
			repositoryPath: repository.path,
		})) ??
		repository.defaultBranch ??
		DEFAULT_FALLBACK_BRANCH;

	if (!candidateBase) {
		return { baseBranch: fallbackBranch };
	}

	return {
		baseBranch: fallbackBranch,
		diagnostic: abandonedBaseDiagnostic({
			candidateBase,
			fallbackBranch,
			rejection,
		}),
	};
}

/**
 * Reports a configured base the workspace could not come off, keeping a ref the
 * validator refused apart from one that was fetched and still did not resolve.
 * The two ask for different things — correct the setting, versus the branch is
 * gone — and a single code would tell whoever reads the support bundle that a
 * fetch was attempted for a value that never reached one.
 *
 * Both say the workspace *took* the fallback as its base rather than branched
 * from it, because only one of the three plans makes those the same thing: an
 * adopted branch keeps the history it already had, and a create plan carrying
 * its own `forkRef` cuts from that ref. In every case the base is the merge
 * target, which is what these two sentences are actually about.
 * @param options - The abandoned base, the fallback taken, and the validator's
 * rejection when it had one.
 * @returns The warning to attach to the workspace that was created anyway.
 */
function abandonedBaseDiagnostic({
	candidateBase,
	fallbackBranch,
	rejection,
}: {
	candidateBase: string;
	fallbackBranch: string;
	rejection: GitRefRejection | null;
}): CreateWorkspaceDiagnostic {
	const landedOn = `The workspace took "${fallbackBranch}" as its base instead.`;
	if (rejection) {
		return {
			code: 'configured-base-invalid',
			message: `Cannot use "${candidateBase}" as the branch new workspaces fork from. ${rejection.message} ${landedOn}`,
			severity: 'warning',
		};
	}
	return {
		code: 'configured-base-unresolvable',
		message: `Could not resolve "${candidateBase}" in this repository, even after fetching. ${landedOn}`,
		severity: 'warning',
	};
}

/**
 * The local branch names a slug must steer around, or an empty set when the
 * workspace adopts a branch instead of cutting one. Only a plan that cuts can
 * collide: adoption checks an existing branch out, so letting branches steer the
 * slug there would land every adopted workspace in a `-2` folder over the very
 * branch it takes over.
 * @param options - The resolved branch plan plus git command dependencies.
 * @returns Lowercased branch names and segments to treat as claimed.
 */
async function branchNamesToAvoid({
	localCommandService,
	plan,
	repositoryPath,
}: {
	localCommandService: LocalCommandService;
	plan: WorkspaceBranchPlan;
	repositoryPath: string;
}): Promise<ReadonlySet<string>> {
	if (plan.kind !== 'create') {
		return new Set<string>();
	}
	return listLocalBranchNames({ localCommandService, repositoryPath });
}

/**
 * Reads the repo's personal (SQLite) `filesToCopy` patterns from resolved
 * settings so they can layer under committed config. Only the personal `sqlite`
 * source is returned; committed sources are already applied by the files-to-copy
 * service. Returns `undefined` when unset or from another source.
 * @param resolved - Resolved settings snapshot, when available.
 * @returns The personal pattern list, or `undefined`.
 */
function resolveConfiguredFilesToCopy(
	resolved: SettingsResolutionSnapshot | undefined,
): string[] | undefined {
	const setting = resolved?.repository?.settings.find(
		(candidate) => candidate.key === 'filesToCopy',
	);

	if (setting?.source !== 'sqlite' || !Array.isArray(setting.value)) {
		return undefined;
	}

	return setting.value.filter(
		(entry): entry is string => typeof entry === 'string',
	);
}

const DEFAULT_WORKSPACE_NAME = 'workspace';
const CONTEXT_DIRECTORY = '.context';
const GIT_LS_FILES_TIMEOUT_MS = 15_000;
const GIT_LS_FILES_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * Builds the service that creates isolated git worktree workspaces under the
 * managed root, branches them from the configured base, persists a row in
 * SQLite, and registers the per-workspace `.context/` directory in the repo's
 * local git exclude. The directory itself is created lazily on first write
 * (e.g. by the session-summary writer) so a freshly created workspace root
 * stays empty for scaffolders such as `create-next-app`.
 * @param options - Service dependencies and tuning overrides.
 * @returns A {@link CreateWorkspaceService}.
 */
export function createWorkspaceService({
	databaseService,
	filesToCopyService,
	githubUsernameResolver,
	loadConfig = loadRepositoryConfig,
	localCommandService,
	now = () => new Date(),
	readGitDefaults,
	readRepositorySettings,
	rootDirectoryService,
}: CreateWorkspaceServiceOptions): CreateWorkspaceService {
	const filesToCopy =
		filesToCopyService ?? createFilesToCopyService({ localCommandService });
	// Serializes creation per repository so concurrent triggers ("+" clicks,
	// first-workspace seeding, conversation forks) never run overlapping
	// `git fetch`/`git worktree add` against the same repo — the lock contention
	// that made creation fail intermittently. Different repositories still run in
	// parallel: they have independent git directories and share no lock.
	const pendingByRepository = new Map<string, Promise<CreateWorkspaceResult>>();

	/**
	 * Runs a single workspace creation end to end: request validation,
	 * base-branch resolution, `git worktree add`, files-to-copy, and the SQLite
	 * row insert. Callers reach it through {@link create}, which serializes it
	 * per repository.
	 * @param request - The create-workspace IPC request.
	 * @returns The create result — a success snapshot or failure diagnostics.
	 */
	const runCreate = async (
		request: CreateWorkspaceRequest,
	): Promise<CreateWorkspaceResult> => {
		const database = databaseService.getConnection()?.database;
		if (!database) {
			return failure({
				code: 'database-unavailable',
				message: 'SQLite is unavailable; the workspace was not created.',
				severity: 'error',
			});
		}

		const requestedId =
			typeof request.repositoryId === 'string'
				? request.repositoryId.trim()
				: '';
		if (!requestedId) {
			return failure({
				code: 'repository-id-required',
				message: 'A repository id is required to create a workspace.',
				severity: 'error',
			});
		}

		const repository = readRepository(database, requestedId);
		if (!repository) {
			return failure({
				code: 'repository-not-found',
				message: `No repository is registered with id ${requestedId}.`,
				severity: 'error',
			});
		}

		const nameDiagnostic = validateName(request.name);
		if (nameDiagnostic) {
			return failure(nameDiagnostic);
		}

		const rootSnapshot =
			rootDirectoryService.getSnapshot() ?? rootDirectoryService.ensure();
		if (!rootSnapshot.workspacesPath) {
			return failure({
				code: 'repositories-path-missing',
				message:
					'The managed root has no workspaces path; configure the root directory first.',
				severity: 'error',
			});
		}

		const config = loadConfig({ now, repositoryPath: repository.path });
		const branchPrefix = await resolveBranchPrefix({
			config,
			githubUsernameResolver,
			readGitDefaults,
		});
		const resolvedSettings = readRepositorySettings?.({
			repository: {
				repositoryId: repository.id,
				repositoryPath: repository.path,
			},
		});
		const branchPoint = await resolveBranchPoint({
			configuredBase: resolveConfiguredBranchFrom(resolvedSettings),
			localCommandService,
			repository,
			request,
		});
		const prepared = prepareWorkspace({
			branchNameOverride: request.branchName,
			branchPoint,
			branchPrefix,
			database,
			existingBranches: await branchNamesToAvoid({
				localCommandService,
				plan: branchPoint.plan,
				repositoryPath: repository.path,
			}),
			nameInput: request.name,
			placeholderName: request.placeholderName === true,
			repository,
			workspacesPath: rootSnapshot.workspacesPath,
		});

		if (existsSync(prepared.path)) {
			return failure({
				code: 'destination-exists',
				message: `A file or directory already exists at ${prepared.path}.`,
				path: prepared.path,
				severity: 'error',
			});
		}

		const parentDiagnostic = ensureParentDirectory(prepared.parentDirectory);
		if (parentDiagnostic) {
			return failure(parentDiagnostic);
		}

		const worktree = await createWorktree({
			localCommandService,
			repositoryPath: repository.path,
			request: {
				baseBranch: prepared.baseBranch,
				branchName: prepared.branchName,
				plan: prepared.plan,
				workspacePath: prepared.path,
			},
		});
		if ('diagnostic' in worktree) {
			const holder = readWorkspaceHoldingBranch({
				database,
				diagnostic: worktree.diagnostic,
				repositoryId: repository.id,
			});
			return holder
				? {
						diagnostics: [],
						filesToCopy: null,
						reusedExisting: true,
						status: 'success',
						workspace: holder,
					}
				: failure(worktree.diagnostic);
		}

		// Best-effort: ensure `.context/` is git-ignored before anything can
		// write to it. Failure is non-fatal (the directory is still usable;
		// it just may show up in `git status`), so we do not roll back.
		await addContextDirToGitExclude({
			localCommandService,
			workspacePath: prepared.path,
		});

		const filesToCopySnapshot = await runFilesToCopy({
			config,
			filesToCopyService: filesToCopy,
			personalPatterns: resolveConfiguredFilesToCopy(resolvedSettings),
			repositoryPath: repository.path,
			workspacePath: prepared.path,
		});
		const workspaceFileCount = await countWorkspaceFiles({
			filesToCopySnapshot,
			localCommandService,
			workspacePath: prepared.path,
		});

		const timestamp = now().toISOString();
		const initialMetadata = buildInitialWorkspaceMetadata({
			adoptedBranch: prepared.plan.kind === 'adopt',
			filesToCopySnapshot,
			linkedIssue: request.linkedIssue,
			placeholderName: request.placeholderName === true,
			workspaceFileCount,
		});
		try {
			insertWorkspaceRow({
				database,
				linkedIssue: request.linkedIssue,
				metadataJson: JSON.stringify(initialMetadata),
				prepared,
				timestamp,
			});
		} catch (error) {
			await rollbackWorktree({
				branchName: prepared.branchName,
				createdBranch: worktree.createdBranch,
				localCommandService,
				repositoryPath: repository.path,
				workspacePath: prepared.path,
			});
			await cleanupWorkspaceDirectory(prepared.path);
			const message = error instanceof Error ? error.message : '';
			// SQLite's UNIQUE(repository_id, slug) is the authoritative
			// guard against concurrent same-slug workspace creation.
			if (/UNIQUE constraint failed/i.test(message)) {
				return failure({
					code: 'destination-exists',
					message: `A workspace with slug "${prepared.slug}" already exists for this repository.`,
					path: prepared.path,
					severity: 'error',
				});
			}
			return failure({
				code: 'workspace-insert-failed',
				message: message || 'Failed to write the workspace record to SQLite.',
				path: prepared.path,
				severity: 'error',
			});
		}

		const workspace: CreatedWorkspaceSnapshot = {
			archivedAt: null,
			baseBranch: prepared.baseBranch,
			branchName: prepared.branchName,
			createdAt: timestamp,
			id: prepared.id,
			metadata: initialMetadata,
			name: prepared.name,
			path: prepared.path,
			repositoryId: repository.id,
			slug: prepared.slug,
			updatedAt: timestamp,
		};

		return {
			diagnostics: branchPoint.diagnostic ? [branchPoint.diagnostic] : [],
			filesToCopy: filesToCopySnapshot,
			reusedExisting: false,
			status: 'success',
			workspace,
		};
	};

	/**
	 * Serializes {@link runCreate} behind any in-flight creation for the same
	 * repository so overlapping requests can never race on the repo's git locks
	 * or on slug allocation. The pending promise spans the entire creation, so a
	 * concurrent request always observes the prior one's committed workspace row
	 * before it allocates its own slug. Creation for other repositories proceeds
	 * concurrently.
	 * @param request - The create-workspace IPC request.
	 * @returns The create result — a success snapshot or failure diagnostics.
	 */
	const create = async (
		request: CreateWorkspaceRequest,
	): Promise<CreateWorkspaceResult> => {
		const repositoryKey =
			typeof request.repositoryId === 'string'
				? request.repositoryId.trim()
				: '';
		const prior = pendingByRepository.get(repositoryKey);
		const run = (async () => {
			if (prior) {
				await prior.catch(() => undefined);
			}
			return runCreate(request);
		})();
		pendingByRepository.set(repositoryKey, run);
		try {
			return await run;
		} finally {
			if (pendingByRepository.get(repositoryKey) === run) {
				pendingByRepository.delete(repositoryKey);
			}
		}
	};

	return { create };
}

/**
 * Runs the files-to-copy step, swallowing service-level exceptions into a
 * warning so a partial failure never aborts a freshly-created workspace.
 * @param input - The active config, copy service, and source/target paths.
 * @returns A snapshot describing the copy outcome; never throws.
 */
async function runFilesToCopy({
	config,
	filesToCopyService,
	personalPatterns,
	repositoryPath,
	workspacePath,
}: {
	config: LoadedRepositoryConfig;
	filesToCopyService: FilesToCopyService;
	personalPatterns?: readonly string[];
	repositoryPath: string;
	workspacePath: string;
}): Promise<FilesToCopySnapshot> {
	try {
		return await filesToCopyService.copy({
			config,
			personalPatterns,
			repositoryPath,
			workspacePath,
		});
	} catch (error) {
		return {
			copied: [],
			diagnostics: [
				{
					code: 'copy-failed',
					message:
						error instanceof Error
							? error.message
							: 'Files-to-copy failed unexpectedly.',
					severity: 'warning',
				},
			],
			patterns: [],
			skipped: [],
			source: 'default',
		};
	}
}

/**
 * Counts tracked worktree files plus local-only files copied after checkout.
 * @param input - Command service, workspace path, and local copy snapshot.
 * @returns The total workspace file count, or `null` when git cannot enumerate.
 */
async function countWorkspaceFiles({
	filesToCopySnapshot,
	localCommandService,
	workspacePath,
}: {
	filesToCopySnapshot: FilesToCopySnapshot;
	localCommandService: LocalCommandService;
	workspacePath: string;
}): Promise<number | null> {
	try {
		const result = await localCommandService.run({
			args: ['ls-files', '-z'],
			command: 'git',
			cwd: workspacePath,
			maxOutputBytes: GIT_LS_FILES_MAX_OUTPUT_BYTES,
			timeoutMs: GIT_LS_FILES_TIMEOUT_MS,
		});

		if (result.status !== 'success' || result.stdoutTruncated) {
			return null;
		}

		return (
			parseNullSeparated(result.stdout).length +
			filesToCopySnapshot.copied.length
		);
	} catch {
		return null;
	}
}

/**
 * Splits a NUL-separated git output stream into non-empty path entries.
 * @param value - Raw stdout from `git ls-files -z`.
 * @returns The list of paths.
 */
function parseNullSeparated(value: string): string[] {
	return value.split('\0').filter((entry) => entry.length > 0);
}

/**
 * Resolves the diagnostic that refused a branch as already checked out into the
 * workspace that holds it, so the request can open that workspace instead of
 * reporting an error the user can do nothing with.
 *
 * Only a `branch-already-checked-out` diagnostic can be answered this way, and
 * only when its holder is an *active* workspace of this repository: an archived
 * one has no route to navigate to, and the repository folder — which the
 * refusal also covers — is not a workspace at all. Anything else stays a
 * failure.
 *
 * Paths are compared by their real location rather than in SQL: git reports
 * worktree paths with symlinks resolved, so a workspace under `/var/...` comes
 * back from git as `/private/var/...` and a string compare would miss it.
 * @param options - The refusal, the repository it came from, and the database.
 * @returns The holding workspace's snapshot, or null when there is none.
 */
function readWorkspaceHoldingBranch({
	database,
	diagnostic,
	repositoryId,
}: {
	database: DatabaseSync;
	diagnostic: CreateWorkspaceDiagnostic;
	repositoryId: string;
}): CreatedWorkspaceSnapshot | null {
	if (diagnostic.code !== 'branch-already-checked-out' || !diagnostic.path) {
		return null;
	}
	const holderPath = diagnostic.path;
	const row = listActiveWorkspaceSnapshotRowsByRepository({
		database,
		repositoryId,
	}).find((candidate) => isSamePath(candidate.path, holderPath));
	return row
		? {
				archivedAt: null,
				baseBranch: row.baseBranch,
				branchName: row.branchName,
				createdAt: row.createdAt,
				id: row.id,
				metadata: parseMetadata(row.metadataJson),
				name: row.name,
				path: row.path,
				repositoryId,
				slug: row.slug,
				updatedAt: row.updatedAt,
			}
		: null;
}

/**
 * Builds the standard failure shape for any rejected create request.
 * @param diagnostic - Diagnostic to surface as the single failure entry.
 */
function failure(diagnostic: CreateWorkspaceDiagnostic): CreateWorkspaceResult {
	return {
		diagnostics: [diagnostic],
		filesToCopy: null,
		reusedExisting: false,
		status: 'failure',
		workspace: null,
	};
}

/**
 * Loads the repository row and projects it onto the fields the service needs.
 * @param database - Open SQLite connection.
 * @param repositoryId - Repository id from the request.
 */
function readRepository(
	database: DatabaseSync,
	repositoryId: string,
): SourceRepository | null {
	const row = selectRepositoryWithDefaultsById({
		database,
		id: repositoryId,
	});
	if (!isRepositoryRow(row)) {
		return null;
	}
	return {
		defaultBranch: row.default_branch,
		id: row.id,
		path: row.path,
		slug: row.slug,
	};
}

/**
 * Validates an optional workspace name; rejects path separators, unsafe chars,
 * leading dots, and overlong values.
 *
 * `undefined`, `null`, and empty/whitespace strings are treated as "no name
 * provided" and pass through — the create flow substitutes a default name
 * downstream. All other invalid inputs return a `name-invalid` diagnostic.
 * @param name - Caller-provided name; `undefined` is allowed (placeholder used).
 */
function validateName(name: unknown): CreateWorkspaceDiagnostic | null {
	if (name === undefined || name === null) {
		return null;
	}
	if (typeof name !== 'string') {
		return {
			code: 'name-invalid',
			message: 'Workspace name must be a string.',
			severity: 'error',
		};
	}
	const trimmed = name.trim();
	if (!trimmed) {
		return null;
	}
	const result = validateWorkspaceName(trimmed);
	if (result.valid) {
		return null;
	}
	return {
		code: 'name-invalid',
		message: result.message,
		severity: 'error',
	};
}

/**
 * Reads the committed `[git] branch_prefix` from the loaded
 * `.ensemblr/settings.toml` config. The TOML parser normalizes the nested
 * `[git]` block onto canonical top-level keys, so the prefix lives at
 * `branchPrefix`. Returns an empty string when no string-valued prefix is set.
 */
function readBranchPrefix(config: LoadedRepositoryConfig): string {
	const prefix = config.ensemblrConfig?.branchPrefix;

	return typeof prefix === 'string' && prefix.length > 0 ? prefix : '';
}

/**
 * Resolves the branch-name prefix for a new workspace. A repository-scoped
 * `git.branchPrefix` always wins (it is the team/shared override); otherwise the
 * user-scope default applies: an empty prefix for `none`, the literal custom
 * value for `custom`, and the GitHub login for `github-username` (resolved via
 * gh, empty when unavailable). With no user defaults wired the repo value is
 * used alone, preserving the legacy behavior. Any trailing slash is normalized
 * away — {@link joinBranchName} re-inserts a single separator.
 * @param input - Repo config, the gh resolver, and the user-defaults reader.
 * @returns The bare prefix (no trailing slash) for {@link joinBranchName}.
 */
async function resolveBranchPrefix({
	config,
	githubUsernameResolver,
	readGitDefaults,
}: {
	config: LoadedRepositoryConfig;
	githubUsernameResolver?: GithubUsernameResolver;
	readGitDefaults?: () => GitSettings;
}): Promise<string> {
	const repoPrefix = readBranchPrefix(config);
	if (repoPrefix) {
		return repoPrefix;
	}

	if (!readGitDefaults) {
		return '';
	}

	const git = readGitDefaults();
	switch (git.branchPrefixSource) {
		case 'none':
			return '';
		case 'custom':
			return git.branchPrefixCustom;
		case 'github-username': {
			const login = await githubUsernameResolver?.resolve();
			return login ?? '';
		}
		default:
			return '';
	}
}

/**
 * Resolves the placeholder name, allocates a unique slug for the repository,
 * settles on the branch the worktree will carry, and computes the workspace
 * path. An adopted branch keeps its own name; every other mode derives one from
 * the caller's override or the prefixed slug.
 *
 * `existingBranches` arrives already scoped to the plan: the caller passes the
 * repository's branches only when one is about to be cut, and an empty set when
 * the workspace adopts a branch that by definition already exists.
 */
function prepareWorkspace({
	branchNameOverride,
	branchPoint,
	branchPrefix,
	database,
	existingBranches,
	nameInput,
	placeholderName,
	repository,
	workspacesPath,
}: {
	branchNameOverride: string | undefined;
	branchPoint: WorkspaceBranchPoint;
	branchPrefix: string;
	database: DatabaseSync;
	existingBranches: ReadonlySet<string>;
	nameInput: string | undefined;
	placeholderName: boolean;
	repository: SourceRepository;
	workspacesPath: string;
}): PreparedWorkspace {
	const trimmedName =
		typeof nameInput === 'string' && nameInput.trim()
			? nameInput.trim()
			: DEFAULT_WORKSPACE_NAME;
	const taken = collectTakenWorkspaceNames({
		database,
		existingBranches,
		repositoryId: repository.id,
	});
	const resolvedName = placeholderName
		? resolvePlaceholderName({ requestedName: trimmedName, taken })
		: trimmedName;
	const baseSlug = toWorkspaceSlug(resolvedName);
	const slug = allocateUniqueWorkspaceSlug({
		baseSlug,
		database,
		repositoryId: repository.id,
		taken,
	});
	const parentDirectory = path.join(workspacesPath, repository.slug);
	const workspacePath = path.join(parentDirectory, slug);
	const cutBranchName =
		typeof branchNameOverride === 'string' && branchNameOverride.trim()
			? branchNameOverride.trim()
			: joinBranchName(branchPrefix, slug);

	return {
		baseBranch: branchPoint.baseBranch,
		branchName:
			branchPoint.plan.kind === 'adopt'
				? branchPoint.plan.branch
				: cutBranchName,
		id: `workspace-${randomUUID()}`,
		name: resolvedName,
		parentDirectory,
		path: workspacePath,
		plan: branchPoint.plan,
		repository,
		slug,
	};
}

/**
 * Chooses a placeholder workspace name nothing in the repository already claims.
 * Keeps the caller's suggested composer surname when it is free (the common
 * case, so the optimistic sidebar row does not flicker); otherwise repicks
 * another surname that avoids every taken token. Falls back to the suggested
 * name when the pool is exhausted, leaving slug allocation to disambiguate.
 * @param options.requestedName - Surname the renderer optimistically picked.
 * @param options.taken - Every name, slug, and branch already claimed.
 * @returns A workspace display name unused across the repository's history.
 */
function resolvePlaceholderName({
	requestedName,
	taken,
}: {
	requestedName: string;
	taken: ReadonlySet<string>;
}): string {
	const requestedTokens = [
		requestedName.toLowerCase(),
		toWorkspaceSlug(requestedName),
	];
	if (requestedTokens.every((token) => !taken.has(token))) {
		return requestedName;
	}
	return pickComposerSurname({ exclude: [...taken] });
}

/**
 * Builds the lowercased set of every token a new workspace may not reuse: the
 * names and slugs of the repository's workspaces, active or archived, plus every
 * local git branch.
 *
 * Slugs are included because a renamed workspace keeps its original slug, so it
 * reveals the name used before the rename. Branches are included because a
 * branch outlives the workspace that cut it — a deleted workspace takes its row
 * with it and leaves the branch, which reads as a free name right up until
 * `git worktree add -b` refuses it.
 * @param options - Repository scope, git branches, and the open connection.
 * @returns The lowercased set of claimed tokens.
 */
function collectTakenWorkspaceNames({
	database,
	existingBranches,
	repositoryId,
}: {
	database: DatabaseSync;
	existingBranches: ReadonlySet<string>;
	repositoryId: string;
}): Set<string> {
	const rows = listWorkspaceNameSlugRowsByRepository({
		database,
		repositoryId,
	});
	const taken = new Set<string>(existingBranches);
	for (const { name, slug } of rows) {
		for (const value of [name, slug]) {
			if (typeof value === 'string' && value.trim()) {
				taken.add(value.toLowerCase());
			}
		}
	}
	return taken;
}

/**
 * Produces a slug that collides with no existing workspace slug and no local
 * branch, suffixing `-2`, `-3`, ... until a free slot is found.
 * @param options - Base slug, repository scope, claimed tokens, and connection.
 * @returns The free slug.
 */
function allocateUniqueWorkspaceSlug({
	baseSlug,
	database,
	repositoryId,
	taken,
}: {
	baseSlug: string;
	database: DatabaseSync;
	repositoryId: string;
	taken: ReadonlySet<string>;
}): string {
	let candidate = baseSlug;
	let suffix = 2;
	while (
		taken.has(candidate) ||
		workspaceSlugExists(database, repositoryId, candidate)
	) {
		candidate = `${baseSlug}-${suffix}`;
		suffix += 1;
	}
	return candidate;
}

/** Tests whether a slug is already taken inside the given repository. */
function workspaceSlugExists(
	database: DatabaseSync,
	repositoryId: string,
	slug: string,
): boolean {
	return workspaceSlugExistsStorage({ database, repositoryId, slug });
}

/** Normalises a candidate name into a URL-safe slug with stable fallback. */
function toWorkspaceSlug(value: string): string {
	return toSlug(value, DEFAULT_WORKSPACE_NAME);
}

/**
 * Confirms the per-repository workspaces parent exists, creating it when
 * missing; returns a diagnostic on filesystem failure.
 */
function ensureParentDirectory(
	parentPath: string,
): CreateWorkspaceDiagnostic | null {
	try {
		mkdirSync(parentPath, { recursive: true });
		return null;
	} catch (error) {
		return {
			code: 'destination-not-writable',
			message:
				error instanceof Error
					? error.message
					: `Failed to prepare ${parentPath}.`,
			path: parentPath,
			severity: 'error',
		};
	}
}

/**
 * Best-effort removal of a worktree and, when this creation cut it, its branch
 * after a post-worktree failure. A branch the workspace adopted is left alone —
 * it predates the workspace and may still back a pull request. Cleanup never
 * replaces the primary diagnostic.
 */
async function rollbackWorktree({
	branchName,
	createdBranch,
	localCommandService,
	repositoryPath,
	workspacePath,
}: {
	branchName: string;
	createdBranch: boolean;
	localCommandService: LocalCommandService;
	repositoryPath: string;
	workspacePath: string;
}): Promise<void> {
	try {
		await localCommandService.run({
			args: ['worktree', 'remove', '--force', workspacePath],
			command: 'git',
			cwd: repositoryPath,
			maxOutputBytes: 16 * 1024,
			timeoutMs: GIT_WORKTREE_TIMEOUT_MS,
		});
	} catch {
		// Leave any stuck state for manual inspection.
	}
	if (!createdBranch) {
		return;
	}
	// Delete the branch even when worktree removal fails, so the freshly
	// created branch never lingers after a rolled-back workspace.
	try {
		await runBranchDelete({
			branchName,
			localCommandService,
			repositoryPath,
		});
	} catch {
		// Leave any stuck state for manual inspection.
	}
}

/**
 * Registers `.context/` in the worktree's shared git exclude so the
 * per-workspace handoff directory is ignored in any repository — including one
 * whose tracked `.gitignore` is later regenerated by a scaffolder such as
 * `create-next-app`. Writes to `<git-common-dir>/info/exclude`, which lives
 * outside the working tree and is the only exclude file git honors for
 * worktrees. Idempotent across workspaces that share a repo. Best-effort: a
 * failure leaves `.context/` un-ignored but never fails workspace creation.
 */
async function addContextDirToGitExclude({
	localCommandService,
	workspacePath,
}: {
	localCommandService: LocalCommandService;
	workspacePath: string;
}): Promise<void> {
	try {
		const result = await localCommandService.run({
			args: ['rev-parse', '--git-common-dir'],
			command: 'git',
			cwd: workspacePath,
			maxOutputBytes: 16 * 1024,
			timeoutMs: GIT_WORKTREE_TIMEOUT_MS,
		});
		const rawCommonDir = result.stdout.trim();
		if (result.status !== 'success' || !rawCommonDir) {
			return;
		}

		// `--git-common-dir` may be absolute or relative to the worktree;
		// normalize exactly as git-probe does.
		const commonDir = path.isAbsolute(rawCommonDir)
			? path.resolve(rawCommonDir)
			: path.resolve(workspacePath, rawCommonDir);
		const excludePath = path.join(commonDir, 'info', 'exclude');

		const existing = existsSync(excludePath)
			? readFileSync(excludePath, 'utf8')
			: '';
		const alreadyIgnored = existing.split('\n').some((line) => {
			const trimmed = line.trim();
			return (
				trimmed === CONTEXT_DIRECTORY || trimmed === `${CONTEXT_DIRECTORY}/`
			);
		});
		if (alreadyIgnored) {
			return;
		}

		mkdirSync(path.dirname(excludePath), { recursive: true });
		const leadingNewline =
			existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
		appendFileSync(
			excludePath,
			`${leadingNewline}${CONTEXT_DIRECTORY}/\n`,
			'utf8',
		);
	} catch (error) {
		console.warn('[create-workspace] Failed to add .context/ to git exclude.', {
			cause: error instanceof Error ? error.message : String(error),
			workspacePath,
		});
	}
}

/**
 * Builds the initial workspace metadata record stored under `metadata_json`,
 * capturing the files-to-copy outcome plus the total workspace file count so
 * the renderer landing card can show the count without recomputing it. The
 * count lives at the top level because it describes the whole worktree, not the
 * files-to-copy step, whose per-step stats stay nested under `filesToCopy`.
 *
 * The `linkedIssue` copy here is a denormalized read model for the renderer
 * (which only sees workspace rows); the `integration_metadata` row written in
 * the same transaction is the canonical, queryable link. Both are written once
 * at creation and never updated afterwards.
 */
function buildInitialWorkspaceMetadata({
	adoptedBranch,
	filesToCopySnapshot,
	linkedIssue,
	placeholderName,
	workspaceFileCount,
}: {
	adoptedBranch?: boolean;
	filesToCopySnapshot: FilesToCopySnapshot;
	linkedIssue?: WorkspaceLinkedIssueInput;
	placeholderName?: boolean;
	workspaceFileCount: number | null;
}): Record<string, unknown> {
	return {
		filesToCopy: {
			copiedCount: filesToCopySnapshot.copied.length,
			skippedCount: filesToCopySnapshot.skipped.length,
			source: filesToCopySnapshot.source,
		},
		...(workspaceFileCount !== null ? { workspaceFileCount } : {}),
		...(linkedIssue ? { linkedIssue } : {}),
		...(placeholderName ? { placeholderName: true } : {}),
		...(adoptedBranch ? { adoptedBranch: true } : {}),
	};
}

/**
 * Inserts the `workspaces` row plus, for issue-seeded workspaces, the
 * `integration_metadata` link row inside one transaction.
 */
function insertWorkspaceRow({
	database,
	linkedIssue,
	metadataJson,
	prepared,
	timestamp,
}: {
	database: DatabaseSync;
	linkedIssue?: WorkspaceLinkedIssueInput;
	metadataJson: string;
	prepared: PreparedWorkspace;
	timestamp: string;
}): void {
	withTransaction(database, () => {
		insertWorkspaceRowStorage({
			baseBranch: prepared.baseBranch,
			branchName: prepared.branchName,
			database,
			id: prepared.id,
			metadataJson,
			name: prepared.name,
			path: prepared.path,
			repositoryId: prepared.repository.id,
			slug: prepared.slug,
			timestamp,
		});

		if (linkedIssue) {
			database
				.prepare(
					`INSERT INTO integration_metadata
						(id, provider, resource_type, resource_id, external_id, synced_at, metadata_json)
					 VALUES (?, ?, 'workspace-link', ?, ?, ?, ?)`,
				)
				.run(
					randomUUID(),
					linkedIssue.provider,
					prepared.id,
					linkedIssue.id,
					timestamp,
					JSON.stringify(linkedIssue),
				);
		}
	});
}

/** Type guard for repository rows returned by the lookup query. */
function isRepositoryRow(row: unknown): row is {
	default_branch: string | null;
	id: string;
	path: string;
	slug: string;
} {
	if (typeof row !== 'object' || row === null) {
		return false;
	}
	const candidate = row as Record<string, unknown>;
	return (
		typeof candidate.id === 'string' &&
		typeof candidate.slug === 'string' &&
		typeof candidate.path === 'string' &&
		(candidate.default_branch === null ||
			typeof candidate.default_branch === 'string')
	);
}

/**
 * Diagnostic type re-export used by IPC handlers when normalising responses.
 */
export type { CreateWorkspaceDiagnosticCode };
