import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type {
	CreatedWorkspaceSnapshot,
	CreateWorkspaceDiagnostic,
	CreateWorkspaceDiagnosticCode,
	CreateWorkspaceRequest,
	CreateWorkspaceResult,
	FilesToCopySnapshot,
} from '../../shared/ipc';
import type { LocalCommandService } from '../commands/local-command';
import {
	type LoadedRepositoryConfig,
	type LoadRepositoryConfigOptions,
	loadRepositoryConfig,
} from '../config/repository-config.ts';
import type { EnsembleRootDirectoryService } from '../root';
import type { EnsembleDatabaseService } from '../storage/database.ts';
import { withTransaction } from '../storage/tx.ts';
import {
	createFilesToCopyService,
	type FilesToCopyService,
} from './files-to-copy.ts';
import {
	DEFAULT_FALLBACK_BRANCH,
	GIT_WORKTREE_TIMEOUT_MS,
	runWorktreeAdd as runWorktreeAddShared,
} from './git-ops.ts';
import { toSlug } from './slug.ts';
import { validateWorkspaceName } from './workspace-validation.ts';

/** Public surface of the workspace creation service. */
export interface CreateWorkspaceService {
	create: (request: CreateWorkspaceRequest) => Promise<CreateWorkspaceResult>;
}

/** Options for {@link createWorkspaceService}. */
export interface CreateWorkspaceServiceOptions {
	databaseService: EnsembleDatabaseService;
	filesToCopyService?: FilesToCopyService;
	loadConfig?: (options: LoadRepositoryConfigOptions) => LoadedRepositoryConfig;
	localCommandService: LocalCommandService;
	now?: () => Date;
	rootDirectoryService: EnsembleRootDirectoryService;
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

/**
 * Builds the service that creates isolated git worktree workspaces under the
 * managed root, branches them from the configured base, persists a row in
 * SQLite, and scaffolds the per-workspace `.context/` directory.
 * @param options - Service dependencies and tuning overrides.
 * @returns A {@link CreateWorkspaceService}.
 */
export function createWorkspaceService({
	databaseService,
	filesToCopyService,
	loadConfig = loadRepositoryConfig,
	localCommandService,
	now = () => new Date(),
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
			const branchPrefix = readBranchPrefix(config);
			const prepared = prepareWorkspace({
				baseBranchOverride: request.baseBranch,
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

			const contextDiagnostic = ensureContextDirectory(prepared.path);
			if (contextDiagnostic) {
				await rollbackWorktree({
					localCommandService,
					repositoryPath: repository.path,
					workspacePath: prepared.path,
				});
				cleanupDirectory(prepared.path);
				return failure(contextDiagnostic);
			}

			const filesToCopySnapshot = await runFilesToCopy({
				config,
				filesToCopyService: filesToCopy,
				repositoryPath: repository.path,
				workspacePath: prepared.path,
			});

			const timestamp = now().toISOString();
			const initialMetadata = buildInitialWorkspaceMetadata({
				filesToCopySnapshot,
			});
			try {
				insertWorkspaceRow({
					database,
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
	const row = database
		.prepare(
			'SELECT id, slug, path, default_branch FROM repositories WHERE id = ?',
		)
		.get(repositoryId);
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
 * Reads `git.branchPrefix` from any loaded repository config source; returns
 * an empty string when no string-valued prefix is configured.
 */
function readBranchPrefix(config: LoadedRepositoryConfig): string {
	const candidates: Array<Record<string, unknown> | undefined> = [
		config.ensembleConfig,
		config.conductorLocalConfig,
		config.conductorSharedConfig,
		config.conductorLegacyConfig,
	];
	for (const candidate of candidates) {
		const git = candidate?.git;
		if (git && typeof git === 'object' && !Array.isArray(git)) {
			const prefix = (git as Record<string, unknown>).branchPrefix;
			if (typeof prefix === 'string' && prefix.length > 0) {
				return prefix;
			}
		}
	}
	return '';
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
			: `${branchPrefix}${slug}`;
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
	const row = database
		.prepare('SELECT id FROM workspaces WHERE repository_id = ? AND slug = ?')
		.get(repositoryId, slug);
	return isIdRow(row);
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

/** Creates the per-workspace `.context/` directory; returns a diagnostic on failure. */
function ensureContextDirectory(
	workspacePath: string,
): CreateWorkspaceDiagnostic | null {
	try {
		mkdirSync(path.join(workspacePath, CONTEXT_DIRECTORY), {
			recursive: true,
		});
		return null;
	} catch (error) {
		return {
			code: 'context-directory-failed',
			message:
				error instanceof Error
					? error.message
					: 'Failed to create the workspace .context directory.',
			path: workspacePath,
			severity: 'error',
		};
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
 * capturing the files-to-copy outcome so the renderer landing card can show
 * the actual copied-file count without recomputing the snapshot.
 */
function buildInitialWorkspaceMetadata({
	filesToCopySnapshot,
}: {
	filesToCopySnapshot: FilesToCopySnapshot;
}): Record<string, unknown> {
	return {
		filesToCopy: {
			copiedCount: filesToCopySnapshot.copied.length,
			skippedCount: filesToCopySnapshot.skipped.length,
			source: filesToCopySnapshot.source,
		},
	};
}

/** Inserts a `workspaces` row inside a single transaction. */
function insertWorkspaceRow({
	database,
	metadataJson,
	prepared,
	timestamp,
}: {
	database: DatabaseSync;
	metadataJson: string;
	prepared: PreparedWorkspace;
	timestamp: string;
}): void {
	withTransaction(database, () => {
		database
			.prepare(
				`INSERT INTO workspaces (
					id,
					repository_id,
					slug,
					name,
					path,
					branch_name,
					base_branch,
					created_at,
					updated_at,
					metadata_json
				)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				prepared.id,
				prepared.repository.id,
				prepared.slug,
				prepared.name,
				prepared.path,
				prepared.branchName,
				prepared.baseBranch,
				timestamp,
				timestamp,
				metadataJson,
			);
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

/** Type guard for `SELECT id FROM ...` row shapes. */
function isIdRow(row: unknown): row is { id: string } {
	return (
		typeof row === 'object' &&
		row !== null &&
		'id' in row &&
		typeof (row as { id: unknown }).id === 'string'
	);
}

/**
 * Diagnostic type re-export used by IPC handlers when normalising responses.
 */
export type { CreateWorkspaceDiagnosticCode };
