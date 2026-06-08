import { existsSync, rmSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

import type {
	ArchivedWorkspaceSnapshot,
	ArchiveWorkspaceDiagnostic,
	ArchiveWorkspaceDiagnosticCode,
	ArchiveWorkspaceRequest,
	ArchiveWorkspaceResult,
} from '../../shared/ipc';
import type { LocalCommandService } from '../commands/local-command';
import type { EnsembleDatabaseService } from '../storage/database.ts';
import { firstLine } from './first-line.ts';
import { deleteWorkspaceRow } from './workspace-row-ops.ts';
/** Public surface of the workspace archive service. */
export interface ArchiveWorkspaceService {
	archive: (
		request: ArchiveWorkspaceRequest,
	) => Promise<ArchiveWorkspaceResult>;
}

/** Options for {@link createArchiveWorkspaceService}. */
export interface CreateArchiveWorkspaceServiceOptions {
	databaseService: EnsembleDatabaseService;
	localCommandService: LocalCommandService;
}

/** Internal: source workspace joined with parent repository fields. */
interface SourceWorkspace {
	branchName: string | null;
	id: string;
	name: string;
	path: string;
	repositoryId: string;
	repositoryPath: string;
}

const GIT_WORKTREE_TIMEOUT_MS = 15_000;
const GIT_BRANCH_TIMEOUT_MS = 5_000;

/**
 * Builds the service that archives (permanently deletes) a workspace.
 *
 * Archiving is destructive and intentional: the worktree folder is removed,
 * the local branch is dropped (best-effort), and the SQLite row is deleted.
 * No merge or remote push is performed — callers should already have pushed
 * any work they want to preserve.
 * @param options - Service dependencies.
 * @returns An {@link ArchiveWorkspaceService}.
 */
export function createArchiveWorkspaceService({
	databaseService,
	localCommandService,
}: CreateArchiveWorkspaceServiceOptions): ArchiveWorkspaceService {
	return {
		archive: async (request) => {
			const database = databaseService.getConnection()?.database;
			if (!database) {
				return failure({
					code: 'database-unavailable',
					message: 'SQLite is unavailable; the workspace was not archived.',
					severity: 'error',
				});
			}

			const workspaceId =
				typeof request.workspaceId === 'string'
					? request.workspaceId.trim()
					: '';
			if (!workspaceId) {
				return failure({
					code: 'workspace-id-required',
					message: 'A workspace id is required to archive a workspace.',
					severity: 'error',
				});
			}

			const source = readWorkspace(database, workspaceId);
			if (!source) {
				return failure({
					code: 'workspace-not-found',
					message: `No workspace is registered with id ${workspaceId}.`,
					severity: 'error',
				});
			}

			const diagnostics: ArchiveWorkspaceDiagnostic[] = [];

			// `git worktree remove --force` cleans up the worktree registration
			// inside the source repository. If the directory was already deleted
			// out-of-band, the command may fail — that is fine; we fall through
			// to the filesystem and database deletions.
			await runWorktreeRemove({
				diagnostics,
				localCommandService,
				repositoryPath: source.repositoryPath,
				workspacePath: source.path,
			});

			const pathRemoved = removeWorkspaceDirectory({
				diagnostics,
				workspacePath: source.path,
			});

			let branchDeleted = false;
			if (source.branchName) {
				branchDeleted = await runBranchDelete({
					branchName: source.branchName,
					diagnostics,
					localCommandService,
					repositoryPath: source.repositoryPath,
				});
			}

			try {
				deleteWorkspaceRow({ database, id: source.id });
			} catch (error) {
				diagnostics.push({
					code: 'workspace-delete-failed',
					message:
						error instanceof Error
							? error.message
							: 'Failed to delete the workspace row.',
					severity: 'error',
				});
				return {
					branchDeleted,
					diagnostics,
					pathRemoved,
					status: 'failure',
					workspace: null,
				};
			}

			const workspace: ArchivedWorkspaceSnapshot = {
				branchName: source.branchName,
				id: source.id,
				name: source.name,
				path: source.path,
				repositoryId: source.repositoryId,
			};

			return {
				branchDeleted,
				diagnostics,
				pathRemoved,
				status: 'success',
				workspace,
			};
		},
	};
}

/**
 * Reads the workspace row joined with the parent repository path. Returns
 * `null` when the workspace cannot be resolved.
 */
function readWorkspace(
	database: DatabaseSync,
	workspaceId: string,
): SourceWorkspace | null {
	const row = database
		.prepare(
			`SELECT
				w.id AS id,
				w.repository_id AS repositoryId,
				w.name AS name,
				w.path AS path,
				w.branch_name AS branchName,
				r.path AS repositoryPath
			FROM workspaces w
			INNER JOIN repositories r ON r.id = w.repository_id
			WHERE w.id = ?`,
		)
		.get(workspaceId);

	if (!isWorkspaceRow(row)) {
		return null;
	}
	return row;
}

/**
 * Runs `git worktree remove --force <path>` inside the source repository.
 * Records a warning diagnostic on failure but never aborts the archive — the
 * filesystem and database deletions can still succeed independently.
 */
async function runWorktreeRemove({
	diagnostics,
	localCommandService,
	repositoryPath,
	workspacePath,
}: {
	diagnostics: ArchiveWorkspaceDiagnostic[];
	localCommandService: LocalCommandService;
	repositoryPath: string;
	workspacePath: string;
}): Promise<void> {
	try {
		const result = await localCommandService.run({
			args: ['worktree', 'remove', '--force', workspacePath],
			command: 'git',
			cwd: repositoryPath,
			maxOutputBytes: 16 * 1024,
			timeoutMs: GIT_WORKTREE_TIMEOUT_MS,
		});

		if (result.status === 'success') {
			return;
		}

		diagnostics.push({
			code: 'workspace-delete-failed',
			message:
				firstLine(result.stderr) ||
				`git worktree remove --force exited with status ${result.status}.`,
			path: workspacePath,
			severity: 'warning',
		});
	} catch (error) {
		diagnostics.push({
			code: 'workspace-delete-failed',
			message:
				error instanceof Error
					? error.message
					: 'git worktree remove --force threw unexpectedly.',
			path: workspacePath,
			severity: 'warning',
		});
	}
}

/**
 * Removes the workspace directory from disk. Returns true when the directory
 * is absent after the call (whether or not it existed beforehand). Surfaces a
 * warning when the removal fails so the UI can show a partial-cleanup banner.
 */
function removeWorkspaceDirectory({
	diagnostics,
	workspacePath,
}: {
	diagnostics: ArchiveWorkspaceDiagnostic[];
	workspacePath: string;
}): boolean {
	try {
		rmSync(workspacePath, { force: true, recursive: true });
	} catch (error) {
		diagnostics.push({
			code: 'workspace-delete-failed',
			message:
				error instanceof Error
					? error.message
					: 'Failed to remove the workspace directory.',
			path: workspacePath,
			severity: 'warning',
		});
		return !existsSync(workspacePath);
	}

	return !existsSync(workspacePath);
}

/**
 * Runs `git branch -D <branch>` inside the source repository. Returns true on
 * success, false otherwise. Failures surface as warnings — losing a stray
 * local branch is not a hard error once the worktree and row are gone.
 */
async function runBranchDelete({
	branchName,
	diagnostics,
	localCommandService,
	repositoryPath,
}: {
	branchName: string;
	diagnostics: ArchiveWorkspaceDiagnostic[];
	localCommandService: LocalCommandService;
	repositoryPath: string;
}): Promise<boolean> {
	try {
		const result = await localCommandService.run({
			args: ['branch', '-D', branchName],
			command: 'git',
			cwd: repositoryPath,
			maxOutputBytes: 16 * 1024,
			timeoutMs: GIT_BRANCH_TIMEOUT_MS,
		});

		if (result.status === 'success') {
			return true;
		}

		const stderr = result.stderr || '';
		// `not found` covers the case where the branch was deleted out-of-band
		// or never existed (e.g. the worktree was created without a branch).
		if (stderr.includes('not found') || stderr.includes('No such branch')) {
			return false;
		}

		diagnostics.push({
			code: 'workspace-delete-failed',
			message: firstLine(stderr) || 'git branch -D failed.',
			severity: 'warning',
		});
		return false;
	} catch (error) {
		diagnostics.push({
			code: 'workspace-delete-failed',
			message:
				error instanceof Error
					? error.message
					: 'git branch -D threw unexpectedly.',
			severity: 'warning',
		});
		return false;
	}
}

/** Builds the standard failure shape for any rejected archive request. */
function failure(
	diagnostic: ArchiveWorkspaceDiagnostic,
): ArchiveWorkspaceResult {
	return {
		branchDeleted: false,
		diagnostics: [diagnostic],
		pathRemoved: false,
		status: 'failure',
		workspace: null,
	};
}

/** Type guard for the joined workspace+repository lookup row. */
function isWorkspaceRow(row: unknown): row is {
	branchName: string | null;
	id: string;
	name: string;
	path: string;
	repositoryId: string;
	repositoryPath: string;
} {
	if (typeof row !== 'object' || row === null) {
		return false;
	}
	const candidate = row as Record<string, unknown>;
	return (
		typeof candidate.id === 'string' &&
		typeof candidate.name === 'string' &&
		typeof candidate.path === 'string' &&
		typeof candidate.repositoryId === 'string' &&
		typeof candidate.repositoryPath === 'string' &&
		(candidate.branchName === null || typeof candidate.branchName === 'string')
	);
}

/** Diagnostic type re-export for IPC handler normalisation. */
export type { ArchiveWorkspaceDiagnosticCode };
