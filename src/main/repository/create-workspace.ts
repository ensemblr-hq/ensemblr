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
} from '../../shared/ipc';
import type { LocalCommandService } from '../commands/local-command';
import {
	type LoadedRepositoryConfig,
	type LoadRepositoryConfigOptions,
	loadRepositoryConfig,
} from '../config/repository-config.ts';
import type { EnsembleRootDirectoryService } from '../root';
import type { EnsembleDatabaseService } from '../storage/database.ts';

/** Public surface of the workspace creation service. */
export interface CreateWorkspaceService {
	create: (request: CreateWorkspaceRequest) => Promise<CreateWorkspaceResult>;
}

/** Options for {@link createWorkspaceService}. */
export interface CreateWorkspaceServiceOptions {
	databaseService: EnsembleDatabaseService;
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
const DEFAULT_FALLBACK_BRANCH = 'main';
const WORKSPACE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const WORKSPACE_NAME_MAX_LENGTH = 100;
const GIT_WORKTREE_TIMEOUT_MS = 15_000;
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
	loadConfig = loadRepositoryConfig,
	localCommandService,
	now = () => new Date(),
	rootDirectoryService,
}: CreateWorkspaceServiceOptions): CreateWorkspaceService {
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

			const timestamp = now().toISOString();
			try {
				insertWorkspaceRow({
					database,
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
				return failure({
					code: 'workspace-insert-failed',
					message:
						error instanceof Error
							? error.message
							: 'Failed to write the workspace record to SQLite.',
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
				metadata: {},
				name: prepared.name,
				path: prepared.path,
				repositoryId: repository.id,
				slug: prepared.slug,
				updatedAt: timestamp,
			};

			return {
				diagnostics: [],
				status: 'success',
				workspace,
			};
		},
	};
}

/**
 * Builds the standard failure shape for any rejected create request.
 * @param diagnostic - Diagnostic to surface as the single failure entry.
 */
function failure(diagnostic: CreateWorkspaceDiagnostic): CreateWorkspaceResult {
	return {
		diagnostics: [diagnostic],
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
	if (trimmed.length > WORKSPACE_NAME_MAX_LENGTH) {
		return {
			code: 'name-invalid',
			message: `Workspace names must be ${WORKSPACE_NAME_MAX_LENGTH} characters or fewer.`,
			severity: 'error',
		};
	}
	if (trimmed === '.' || trimmed === '..' || trimmed.startsWith('.')) {
		return {
			code: 'name-invalid',
			message: 'Workspace names cannot start with a dot.',
			severity: 'error',
		};
	}
	if (!WORKSPACE_NAME_PATTERN.test(trimmed)) {
		return {
			code: 'name-invalid',
			message:
				'Workspace names may only contain letters, numbers, dots, dashes, or underscores.',
			severity: 'error',
		};
	}
	return null;
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
	const baseSlug = toSlug(trimmedName);
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
function toSlug(value: string): string {
	const slug = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return slug || DEFAULT_WORKSPACE_NAME;
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
 * Runs `git worktree add -b <branch> <path> <base>` inside the source repo.
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
	const result = await localCommandService.run({
		args: ['worktree', 'add', '-b', branchName, workspacePath, baseBranch],
		command: 'git',
		cwd: repositoryPath,
		maxOutputBytes: 64 * 1024,
		timeoutMs: GIT_WORKTREE_TIMEOUT_MS,
	});

	if (result.status === 'success') {
		return null;
	}

	if (result.failure?.code === 'command-not-found') {
		return {
			code: 'git-not-installed',
			message: 'git was not found in PATH. Install git, then retry.',
			severity: 'error',
		};
	}

	return {
		code: 'git-worktree-failed',
		message: firstLine(result.stderr) || 'git worktree add failed.',
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

/** Inserts a `workspaces` row inside a single transaction. */
function insertWorkspaceRow({
	database,
	prepared,
	timestamp,
}: {
	database: DatabaseSync;
	prepared: PreparedWorkspace;
	timestamp: string;
}): void {
	database.exec('BEGIN');
	try {
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
				'{}',
			);
		database.exec('COMMIT');
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}
}

/** Returns the first non-blank line of `text`; empty string otherwise. */
function firstLine(text: string): string {
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed) {
			return trimmed;
		}
	}
	return '';
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
