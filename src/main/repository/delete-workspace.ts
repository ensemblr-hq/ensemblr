import { existsSync, rmSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

import type {
	DeletedWorkspaceSnapshot,
	DeleteWorkspaceDiagnostic,
	DeleteWorkspaceDiagnosticCode,
	DeleteWorkspaceRequest,
	DeleteWorkspaceResult,
} from '../../shared/ipc/contracts/workspace';
import type { LocalCommandService } from '../commands/local-command';
import type { EnsembleDatabaseService } from '../storage/database.ts';
import { selectDeleteWorkspaceWithRepositoryById } from '../storage/repositories/workspace-repository.ts';
import { runBranchDelete, runWorktreeRemove } from './git-ops.ts';
import { deleteWorkspaceRow } from './workspace-row-ops.ts';

/** Public surface of the workspace delete (destructive) service. */
export interface DeleteWorkspaceService {
	delete: (request: DeleteWorkspaceRequest) => Promise<DeleteWorkspaceResult>;
}

/** Options for {@link createDeleteWorkspaceService}. */
export interface CreateDeleteWorkspaceServiceOptions {
	databaseService: EnsembleDatabaseService;
	localCommandService: LocalCommandService;
}

interface SourceWorkspace {
	branchName: string | null;
	id: string;
	name: string;
	path: string;
	repositoryId: string;
	repositoryPath: string;
}

/**
 * Builds the service that permanently deletes a workspace. Worktree folder is
 * removed, local branch is dropped (best-effort), and the SQLite row is wiped.
 * No `.context/` preservation — callers should have already gone through the
 * lifecycle archive path if they want a chance to recover handoff files.
 */
export function createDeleteWorkspaceService({
	databaseService,
	localCommandService,
}: CreateDeleteWorkspaceServiceOptions): DeleteWorkspaceService {
	return {
		delete: async (request) => {
			const database = databaseService.getConnection()?.database;
			if (!database) {
				return failure({
					code: 'database-unavailable',
					message: 'SQLite is unavailable; the workspace was not deleted.',
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
					message: 'A workspace id is required to delete a workspace.',
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

			const diagnostics: DeleteWorkspaceDiagnostic[] = [];

			const worktreeOutcome = await runWorktreeRemove({
				localCommandService,
				repositoryPath: source.repositoryPath,
				workspacePath: source.path,
			});
			if (worktreeOutcome.status === 'failure') {
				diagnostics.push({
					code: 'workspace-delete-failed',
					message: worktreeOutcome.message,
					path: source.path,
					severity: 'warning',
				});
			}

			const pathRemoved = removeWorkspaceDirectory({
				diagnostics,
				workspacePath: source.path,
			});

			let branchDeleted = false;
			if (source.branchName) {
				const branchOutcome = await runBranchDelete({
					branchName: source.branchName,
					localCommandService,
					repositoryPath: source.repositoryPath,
				});
				if (branchOutcome.status === 'success') {
					branchDeleted = true;
				} else if (branchOutcome.status === 'failure') {
					diagnostics.push({
						code: 'workspace-delete-failed',
						message: branchOutcome.message,
						severity: 'warning',
					});
				}
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

			const workspace: DeletedWorkspaceSnapshot = {
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

function readWorkspace(
	database: DatabaseSync,
	workspaceId: string,
): SourceWorkspace | null {
	const row = selectDeleteWorkspaceWithRepositoryById({
		database,
		workspaceId,
	});

	if (!isWorkspaceRow(row)) {
		return null;
	}
	return row;
}

function removeWorkspaceDirectory({
	diagnostics,
	workspacePath,
}: {
	diagnostics: DeleteWorkspaceDiagnostic[];
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

function failure(diagnostic: DeleteWorkspaceDiagnostic): DeleteWorkspaceResult {
	return {
		branchDeleted: false,
		diagnostics: [diagnostic],
		pathRemoved: false,
		status: 'failure',
		workspace: null,
	};
}

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

export type { DeleteWorkspaceDiagnosticCode };
