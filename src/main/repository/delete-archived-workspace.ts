import { existsSync, rmSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

import type {
	DeleteArchivedWorkspaceDiagnostic,
	DeleteArchivedWorkspaceDiagnosticCode,
	DeleteArchivedWorkspaceRequest,
	DeleteArchivedWorkspaceResult,
} from '../../shared/ipc';
import type { LocalCommandService } from '../commands/local-command';
import type { EnsembleDatabaseService } from '../storage/database.ts';
import { runBranchDelete, runWorktreeRemove } from './git-ops.ts';
import { deleteWorkspaceRow } from './workspace-row-ops.ts';

/** Public surface of the delete-archived-workspace service. */
export interface DeleteArchivedWorkspaceService {
	delete: (
		request: DeleteArchivedWorkspaceRequest,
	) => Promise<DeleteArchivedWorkspaceResult>;
}

/** Options for {@link createDeleteArchivedWorkspaceService}. */
export interface CreateDeleteArchivedWorkspaceServiceOptions {
	databaseService: EnsembleDatabaseService;
	localCommandService: LocalCommandService;
}

interface ArchivedWorkspace {
	archivedContextPath: string | null;
	archivedAt: string | null;
	branchCleanup: boolean;
	branchName: string | null;
	id: string;
	name: string;
	path: string;
	repositoryPath: string;
}

/**
 * Builds the service that permanently purges an archived workspace: removes
 * the preserved `archived-contexts/.../` directory, the worktree folder
 * and registration if still present, the local branch if still present, and
 * the SQLite row (which cascades the `archive_records` rows via foreign key).
 */
export function createDeleteArchivedWorkspaceService({
	databaseService,
	localCommandService,
}: CreateDeleteArchivedWorkspaceServiceOptions): DeleteArchivedWorkspaceService {
	return {
		delete: async (request) => {
			const database = databaseService.getConnection()?.database;
			if (!database) {
				return failure(request.workspaceId, {
					code: 'database-unavailable',
					message:
						'SQLite is unavailable; the archived workspace was not deleted.',
					severity: 'error',
				});
			}

			const workspaceId =
				typeof request.workspaceId === 'string'
					? request.workspaceId.trim()
					: '';
			if (!workspaceId) {
				return failure(workspaceId, {
					code: 'workspace-id-required',
					message: 'A workspace id is required to delete the archive entry.',
					severity: 'error',
				});
			}

			const source = readArchivedWorkspace(database, workspaceId);
			if (!source) {
				return failure(workspaceId, {
					code: 'workspace-not-found',
					message: `No workspace is registered with id ${workspaceId}.`,
					severity: 'error',
				});
			}
			if (!source.archivedAt) {
				return failure(workspaceId, {
					code: 'workspace-not-archived',
					message: `Workspace "${source.name}" is not archived; nothing to purge.`,
					severity: 'info',
				});
			}

			const diagnostics: DeleteArchivedWorkspaceDiagnostic[] = [];

			let pathRemoved = !existsSync(source.path);
			if (!pathRemoved) {
				const worktreeOutcome = await runWorktreeRemove({
					localCommandService,
					repositoryPath: source.repositoryPath,
					workspacePath: source.path,
				});
				if (worktreeOutcome.status === 'failure') {
					diagnostics.push({
						code: 'worktree-cleanup-failed',
						message: worktreeOutcome.message,
						path: source.path,
						severity: 'warning',
					});
				}
				pathRemoved = removeWorkspaceDirectory({
					diagnostics,
					workspacePath: source.path,
				});
			}

			let branchDeleted = false;
			if (source.branchName && !source.branchCleanup) {
				const branchOutcome = await runBranchDelete({
					branchName: source.branchName,
					localCommandService,
					repositoryPath: source.repositoryPath,
				});
				if (branchOutcome.status === 'success') {
					branchDeleted = true;
				} else if (branchOutcome.status === 'failure') {
					diagnostics.push({
						code: 'branch-cleanup-failed',
						message: branchOutcome.message,
						severity: 'warning',
					});
				}
			}

			const contextRemoved = removeArchivedContextDirectory({
				diagnostics,
				preservedPath: source.archivedContextPath,
			});

			try {
				// archive_records FK is ON DELETE CASCADE — deleting the workspace
				// row drops the matching archive history rows atomically.
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
					contextRemoved,
					diagnostics,
					pathRemoved,
					status: 'failure',
					workspaceId: source.id,
				};
			}

			return {
				branchDeleted,
				contextRemoved,
				diagnostics,
				pathRemoved,
				status: 'success',
				workspaceId: source.id,
			};
		},
	};
}

function readArchivedWorkspace(
	database: DatabaseSync,
	workspaceId: string,
): ArchivedWorkspace | null {
	const row = database
		.prepare(
			`SELECT
				w.id AS id,
				w.name AS name,
				w.path AS path,
				w.branch_name AS branchName,
				w.archived_at AS archivedAt,
				r.path AS repositoryPath,
				a.archived_context_path AS archivedContextPath,
				a.branch_cleanup AS branchCleanupRaw
			FROM workspaces w
			INNER JOIN repositories r ON r.id = w.repository_id
			LEFT JOIN archive_records a
				ON a.workspace_id = w.id
				AND a.record_type = 'workspace'
				AND a.id = (
					SELECT id FROM archive_records
					WHERE workspace_id = w.id AND record_type = 'workspace'
					ORDER BY archived_at DESC
					LIMIT 1
				)
			WHERE w.id = ?`,
		)
		.get(workspaceId);

	if (typeof row !== 'object' || row === null) {
		return null;
	}
	const candidate = row as Record<string, unknown>;
	if (
		typeof candidate.id !== 'string' ||
		typeof candidate.name !== 'string' ||
		typeof candidate.path !== 'string' ||
		typeof candidate.repositoryPath !== 'string'
	) {
		return null;
	}
	return {
		archivedAt:
			typeof candidate.archivedAt === 'string' ? candidate.archivedAt : null,
		archivedContextPath:
			typeof candidate.archivedContextPath === 'string'
				? candidate.archivedContextPath
				: null,
		branchCleanup: candidate.branchCleanupRaw === 1,
		branchName:
			typeof candidate.branchName === 'string' ? candidate.branchName : null,
		id: candidate.id,
		name: candidate.name,
		path: candidate.path,
		repositoryPath: candidate.repositoryPath,
	};
}

function removeWorkspaceDirectory({
	diagnostics,
	workspacePath,
}: {
	diagnostics: DeleteArchivedWorkspaceDiagnostic[];
	workspacePath: string;
}): boolean {
	try {
		rmSync(workspacePath, { force: true, recursive: true });
	} catch (error) {
		diagnostics.push({
			code: 'worktree-cleanup-failed',
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

function removeArchivedContextDirectory({
	diagnostics,
	preservedPath,
}: {
	diagnostics: DeleteArchivedWorkspaceDiagnostic[];
	preservedPath: string | null;
}): boolean {
	if (!preservedPath) {
		return false;
	}
	if (!existsSync(preservedPath)) {
		return true;
	}
	try {
		rmSync(preservedPath, { force: true, recursive: true });
		return !existsSync(preservedPath);
	} catch (error) {
		diagnostics.push({
			code: 'archived-context-cleanup-failed',
			message:
				error instanceof Error
					? error.message
					: 'Failed to remove the archived-contexts directory.',
			path: preservedPath,
			severity: 'warning',
		});
		return false;
	}
}

function failure(
	workspaceId: string,
	diagnostic: DeleteArchivedWorkspaceDiagnostic,
): DeleteArchivedWorkspaceResult {
	return {
		branchDeleted: false,
		contextRemoved: false,
		diagnostics: [diagnostic],
		pathRemoved: false,
		status: 'failure',
		workspaceId,
	};
}

export type { DeleteArchivedWorkspaceDiagnosticCode };
