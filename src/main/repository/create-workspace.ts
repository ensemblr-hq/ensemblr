import { randomUUID } from 'node:crypto';
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
} from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type { GitSettings } from '../../shared/config/app-settings.ts';
import type {
	CreatedWorkspaceSnapshot,
	CreateWorkspaceDiagnostic,
	CreateWorkspaceDiagnosticCode,
	CreateWorkspaceRequest,
	CreateWorkspaceResult,
	FilesToCopySnapshot,
	WorkspaceLinkedIssueInput,
} from '../../shared/ipc/contracts/workspace';
import type { LocalCommandService } from '../commands/local-command';
import type {
	LoadedRepositoryConfig,
	LoadRepositoryConfigOptions,
} from '../config';
import { loadRepositoryConfig } from '../config/repository-config.ts';
import type { EnsemblrRootDirectoryService } from '../root';
import type { EnsemblrDatabaseService } from '../storage';
import { selectRepositoryWithDefaultsById } from '../storage/repositories/repository-row-repository.ts';
import {
	insertWorkspaceRow as insertWorkspaceRowStorage,
	workspaceSlugExists as workspaceSlugExistsStorage,
} from '../storage/repositories/workspace-repository.ts';
import { withTransaction } from '../storage/tx.ts';
import { joinBranchName } from './branch-name.ts';
import {
	createFilesToCopyService,
	type FilesToCopyService,
} from './files-to-copy.ts';
import {
	DEFAULT_FALLBACK_BRANCH,
	GIT_WORKTREE_TIMEOUT_MS,
	resolveRootBranch,
	runWorktreeAdd as runWorktreeAddShared,
	syncBaseRef,
} from './git-ops.ts';
import type { GithubUsernameResolver } from './github-username.ts';
import { toSlug } from './slug.ts';
import { validateWorkspaceName } from './workspace-validation.ts';

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
	rootDirectoryService: EnsemblrRootDirectoryService;
}

/** Internal: source repository row loaded from SQLite. */
interface SourceRepository {
	defaultBranch: string | null;
	id: string;
	path: string;
	slug: string;
}

/** Internal: validated request plus derived placement fields. */
interface PreparedWorkspace {
	baseBranch: string;
	branchName: string;
	id: string;
	name: string;
	parentDirectory: string;
	path: string;
	repository: SourceRepository;
	slug: string;
}

const DEFAULT_WORKSPACE_NAME = 'workspace';
const CONTEXT_DIRECTORY = '.context';
const GIT_FETCH_TIMEOUT_MS = 30_000;
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
	rootDirectoryService,
}: CreateWorkspaceServiceOptions): CreateWorkspaceService {
	const filesToCopy =
		filesToCopyService ?? createFilesToCopyService({ localCommandService });
	return {
		create: async (request) => {
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
			// An explicit base (e.g. forking from another workspace) wins; otherwise
			// new workspaces always branch from the repository root, resolved live so
			// a stale/feature `default_branch` can't pin creation to the wrong base.
			const explicitBase = request.baseBranch?.trim();
			const baseBranchOverride = explicitBase
				? explicitBase
				: ((await resolveRootBranch({
						localCommandService,
						repositoryPath: repository.path,
					})) ?? undefined);
			const prepared = prepareWorkspace({
				baseBranchOverride,
				branchNameOverride: request.branchName,
				branchPrefix,
				database,
				nameInput: request.name,
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

			// Best-effort: pull the latest remote commits into the base branch so
			// new workspaces fork from an up-to-date root when online. Any failure
			// (offline, divergence, dirty tree) degrades to the local base rather
			// than blocking creation, so workspaces can still be created offline.
			await syncBaseRef({
				baseBranch: prepared.baseBranch,
				localCommandService,
				repositoryPath: repository.path,
			});

			// A workspace created from a PR (or any remote branch not yet fetched)
			// forks off `origin/<head>`; make sure that ref exists locally first.
			await ensureBaseRefAvailable({
				baseBranch: prepared.baseBranch,
				localCommandService,
				repositoryPath: repository.path,
			});

			const worktreeDiagnostic = await runWorktreeAdd({
				baseBranch: prepared.baseBranch,
				branchName: prepared.branchName,
				localCommandService,
				repositoryPath: repository.path,
				workspacePath: prepared.path,
			});
			if (worktreeDiagnostic) {
				// If the target now exists despite the pre-check, another worker
				// won a TOCTOU race or the directory materialized concurrently.
				// Do not delete it — it belongs to whoever got there first.
				if (existsSync(prepared.path)) {
					return failure({
						code: 'destination-exists',
						message: `A file or directory already exists at ${prepared.path}.`,
						path: prepared.path,
						severity: 'error',
					});
				}
				cleanupDirectory(prepared.path);
				return failure(worktreeDiagnostic);
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
					localCommandService,
					repositoryPath: repository.path,
					workspacePath: prepared.path,
				});
				cleanupDirectory(prepared.path);
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
				diagnostics: [],
				filesToCopy: filesToCopySnapshot,
				status: 'success',
				workspace,
			};
		},
	};
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
	repositoryPath,
	workspacePath,
}: {
	config: LoadedRepositoryConfig;
	filesToCopyService: FilesToCopyService;
	repositoryPath: string;
	workspacePath: string;
}): Promise<FilesToCopySnapshot> {
	try {
		return await filesToCopyService.copy({
			config,
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
		parseNullSeparated(result.stdout).length + filesToCopySnapshot.copied.length
	);
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
 * Builds the standard failure shape for any rejected create request.
 * @param diagnostic - Diagnostic to surface as the single failure entry.
 */
function failure(diagnostic: CreateWorkspaceDiagnostic): CreateWorkspaceResult {
	return {
		diagnostics: [diagnostic],
		filesToCopy: null,
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
 * Reads `git.branchPrefix` from the loaded `.ensemblr/settings.toml` config;
 * returns an empty string when no string-valued prefix is configured.
 */
function readBranchPrefix(config: LoadedRepositoryConfig): string {
	const git = config.ensemblrConfig?.git;

	if (git && typeof git === 'object' && !Array.isArray(git)) {
		const prefix = (git as Record<string, unknown>).branchPrefix;
		if (typeof prefix === 'string' && prefix.length > 0) {
			return prefix;
		}
	}

	return '';
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
 * derives the branch name and base branch, and computes the workspace path.
 */
function prepareWorkspace({
	baseBranchOverride,
	branchNameOverride,
	branchPrefix,
	database,
	nameInput,
	repository,
	workspacesPath,
}: {
	baseBranchOverride: string | undefined;
	branchNameOverride: string | undefined;
	branchPrefix: string;
	database: DatabaseSync;
	nameInput: string | undefined;
	repository: SourceRepository;
	workspacesPath: string;
}): PreparedWorkspace {
	const trimmedName =
		typeof nameInput === 'string' && nameInput.trim()
			? nameInput.trim()
			: DEFAULT_WORKSPACE_NAME;
	const baseSlug = toWorkspaceSlug(trimmedName);
	const slug = allocateUniqueWorkspaceSlug({
		baseSlug,
		database,
		repositoryId: repository.id,
	});
	const parentDirectory = path.join(workspacesPath, repository.slug);
	const workspacePath = path.join(parentDirectory, slug);
	const branchName =
		typeof branchNameOverride === 'string' && branchNameOverride.trim()
			? branchNameOverride.trim()
			: joinBranchName(branchPrefix, slug);
	const baseBranch =
		typeof baseBranchOverride === 'string' && baseBranchOverride.trim()
			? baseBranchOverride.trim()
			: (repository.defaultBranch ?? DEFAULT_FALLBACK_BRANCH);

	return {
		baseBranch,
		branchName,
		id: `workspace-${randomUUID()}`,
		name: trimmedName,
		parentDirectory,
		path: workspacePath,
		repository,
		slug,
	};
}

/**
 * Produces a slug that does not collide with any existing workspace slug for
 * the same repository, suffixing `-2`, `-3`, ... until a free slot is found.
 */
function allocateUniqueWorkspaceSlug({
	baseSlug,
	database,
	repositoryId,
}: {
	baseSlug: string;
	database: DatabaseSync;
	repositoryId: string;
}): string {
	let candidate = baseSlug;
	let suffix = 2;
	while (workspaceSlugExists(database, repositoryId, candidate)) {
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
 * Ensures the worktree base ref resolves locally before `git worktree add`.
 * When it does not (e.g. a pull-request head like `origin/feature-x` that was
 * never fetched), attempts a best-effort `git fetch <remote> <branch>` so the
 * fork can proceed. Already-present refs (local branches, fetched remotes) skip
 * the fetch. All failures are swallowed — `git worktree add` surfaces the real,
 * actionable error if the ref is still missing afterward.
 */
export async function ensureBaseRefAvailable({
	baseBranch,
	localCommandService,
	repositoryPath,
}: {
	baseBranch: string;
	localCommandService: LocalCommandService;
	repositoryPath: string;
}): Promise<void> {
	try {
		const verify = await localCommandService.run({
			args: ['rev-parse', '--verify', '--quiet', `${baseBranch}^{commit}`],
			command: 'git',
			cwd: repositoryPath,
			maxOutputBytes: 4 * 1024,
			timeoutMs: GIT_WORKTREE_TIMEOUT_MS,
		});
		if (verify.status === 'success') {
			return;
		}

		const separator = baseBranch.indexOf('/');
		if (separator <= 0) {
			return;
		}
		const remote = baseBranch.slice(0, separator);
		const branch = baseBranch.slice(separator + 1);
		await localCommandService.run({
			args: ['fetch', remote, branch],
			command: 'git',
			cwd: repositoryPath,
			maxOutputBytes: 64 * 1024,
			timeoutMs: GIT_FETCH_TIMEOUT_MS,
		});
	} catch {
		// Best effort: leave it to `git worktree add` to report a missing ref.
	}
}

/**
 * Runs `git worktree add -b <branch> <path> <base>` inside the source repo
 * by delegating to the shared {@link runWorktreeAddShared} helper, mapping its
 * outcome onto this service's diagnostic shape.
 * @returns A diagnostic on failure; `null` on success.
 */
async function runWorktreeAdd({
	baseBranch,
	branchName,
	localCommandService,
	repositoryPath,
	workspacePath,
}: {
	baseBranch: string;
	branchName: string;
	localCommandService: LocalCommandService;
	repositoryPath: string;
	workspacePath: string;
}): Promise<CreateWorkspaceDiagnostic | null> {
	const outcome = await runWorktreeAddShared({
		baseBranch,
		branchName,
		localCommandService,
		repositoryPath,
		workspacePath,
	});

	if (outcome.status === 'success') {
		return null;
	}

	if (outcome.status === 'git-missing') {
		return {
			code: 'git-not-installed',
			message: outcome.message,
			severity: 'error',
		};
	}

	return {
		code: 'git-worktree-failed',
		message: outcome.message,
		path: workspacePath,
		severity: 'error',
	};
}

/**
 * Best-effort `git worktree remove --force` invoked when a post-worktree step
 * fails; failures are swallowed so the caller-facing diagnostic stays primary.
 */
async function rollbackWorktree({
	localCommandService,
	repositoryPath,
	workspacePath,
}: {
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

/** Removes a half-created workspace directory; failures are swallowed. */
function cleanupDirectory(workspacePath: string): void {
	try {
		rmSync(workspacePath, { force: true, recursive: true });
	} catch {
		// Best effort: leave any stuck files for the user to clean.
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
	filesToCopySnapshot,
	linkedIssue,
	placeholderName,
	workspaceFileCount,
}: {
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
