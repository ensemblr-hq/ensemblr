import { existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

import type {
	DeleteArchivedWorkspaceDiagnostic,
	DeleteArchivedWorkspaceDiagnosticCode,
	DeleteArchivedWorkspaceRequest,
	DeleteArchivedWorkspaceResult,
} from '../../shared/ipc/contracts/workspace';
import type { LocalCommandService } from '../commands/local-command';
import type { EnsemblrDatabaseService } from '../storage';
import { selectDeleteArchivedWorkspaceJoinById } from '../storage/repositories/workspace-repository.ts';
import { runBranchDelete, runRefDelete, runWorktreeRemove } from './git-ops.ts';
import { archivedWorktreeRefFor } from './prune-worktree.ts';
import { removeDirectoryTree } from './remove-directory.ts';
import { deleteWorkspaceRow } from './workspace-row-ops.ts';
import type { WorkspaceTeardownService } from './workspace-teardown.ts';

/** Public surface of the delete-archived-workspace service. */
export interface DeleteArchivedWorkspaceService {
	delete: (
		request: DeleteArchivedWorkspaceRequest,
	) => Promise<DeleteArchivedWorkspaceResult>;
}

/** Options for {@link createDeleteArchivedWorkspaceService}. */
export interface CreateDeleteArchivedWorkspaceServiceOptions {
	databaseService: EnsemblrDatabaseService;
	localCommandService: LocalCommandService;
	workspaceTeardownService: WorkspaceTeardownService;
}

/** Archived-workspace row joined with its archive record, used to drive a permanent delete. */
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
 * and registration if still present, the local branch if still present, the
 * private ref pinning a pruned workspace's snapshot, and the SQLite row (which
 * cascades the `archive_records` rows via foreign key).
 */
export function createDeleteArchivedWorkspaceService({
	databaseService,
	localCommandService,
	workspaceTeardownService,
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

			const teardown = await workspaceTeardownService.teardown({
				workspaceId: source.id,
				workspacePath: source.path,
			});
			for (const message of teardown.failures) {
				diagnostics.push({
					code: 'worktree-cleanup-failed',
					message,
					severity: 'warning',
				});
			}

			let pathRemoved = !existsSync(source.path);
			if (!pathRemoved) {
				// Purging the archive is explicit intent for the directory too, so a
				// `git worktree lock` is released rather than worked around.
				const worktreeOutcome = await runWorktreeRemove({
					localCommandService,
					deletingWorkspace: true,
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
				pathRemoved = worktreeOutcome.status === 'success';
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

			// The prune ref outlives the branch by design, so purging the archive is
			// the only thing that can release the commits it pins.
			await runRefDelete({
				localCommandService,
				ref: archivedWorktreeRefFor(source.id),
				repositoryPath: source.repositoryPath,
			});

			const contextRemoved = await removeArchivedContextDirectory({
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

/**
 * Reads and validates the archived-workspace/archive-record join row.
 * @param database - Open database handle
 * @param workspaceId - Archived workspace to read
 * @returns The archived workspace, or null when missing or malformed
 */
function readArchivedWorkspace(
	database: DatabaseSync,
	workspaceId: string,
): ArchivedWorkspace | null {
	const row = selectDeleteArchivedWorkspaceJoinById({ database, workspaceId });

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

/**
 * Removes the preserved archived-contexts directory when present, recording a
 * diagnostic on failure.
 * @param diagnostics - Diagnostics sink appended to on failure
 * @param preservedPath - Path of the preserved directory, or null when none was kept
 * @returns True when the directory is absent afterwards
 */
async function removeArchivedContextDirectory({
	diagnostics,
	preservedPath,
}: {
	diagnostics: DeleteArchivedWorkspaceDiagnostic[];
	preservedPath: string | null;
}): Promise<boolean> {
	if (!preservedPath) {
		return false;
	}
	if (!existsSync(preservedPath)) {
		return true;
	}

	const outcome = await removeDirectoryTree(preservedPath);

	if (outcome.error !== null || !outcome.removed) {
		diagnostics.push({
			code: 'archived-context-cleanup-failed',
			message:
				outcome.error ?? 'Failed to remove the archived-contexts directory.',
			path: preservedPath,
			severity: 'warning',
		});
		return false;
	}

	return outcome.removed;
}

/**
 * Builds a failed {@link DeleteArchivedWorkspaceResult} for a workspace.
 * @param workspaceId - Workspace the delete was attempted on
 * @param diagnostic - Diagnostic describing the failure
 * @returns The failure result
 */
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
