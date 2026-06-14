import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type { DeletedRepositorySnapshot, DeleteRepositoryDiagnostic, DeleteRepositoryDiagnosticCode, DeleteRepositoryRequest, DeleteRepositoryResult } from '../../shared/ipc/contracts/repository';
import type { LocalCommandService } from '../commands/local-command';
import type { EnsembleRootDirectoryService } from '../root';
import type { EnsembleDatabaseService } from '../storage/database.ts';
import {
	deleteRepositoryRowById,
	selectRepositoryForDelete,
} from '../storage/repositories/repository-row-repository.ts';
import {
	deleteWorkspaceRowsByRepository,
	listWorkspaceDeletionRowsByRepository,
} from '../storage/repositories/workspace-repository.ts';
import { withTransaction } from '../storage/tx.ts';
import { ARCHIVED_REPOSITORY_MARKER } from './archived-marker.ts';
import { runBranchDelete, runWorktreeRemove } from './git-ops.ts';

/** Public surface of the repository delete (destructive) service. */
export interface DeleteRepositoryService {
	delete: (request: DeleteRepositoryRequest) => Promise<DeleteRepositoryResult>;
}

/** Options for {@link createDeleteRepositoryService}. */
export interface CreateDeleteRepositoryServiceOptions {
	databaseService: EnsembleDatabaseService;
	localCommandService: LocalCommandService;
	rootDirectoryService: EnsembleRootDirectoryService;
}

interface SourceRepository {
	id: string;
	name: string;
	path: string;
	slug: string;
	workspaces: SourceWorkspace[];
}

interface SourceWorkspace {
	branchName: string | null;
	id: string;
	name: string;
	path: string;
}

/**
 * Builds the service that destructively removes a repository and every child
 * workspace from Ensemble. Worktrees are wiped, branches are dropped, and the
 * SQLite rows are deleted. The repository folder itself is left in place and
 * tagged with a sentinel so the shared-root reconciler does not resurrect it.
 */
export function createDeleteRepositoryService({
	databaseService,
	localCommandService,
	rootDirectoryService,
}: CreateDeleteRepositoryServiceOptions): DeleteRepositoryService {
	return {
		delete: async (request) => {
			const database = databaseService.getConnection()?.database;
			if (!database) {
				return failure({
					code: 'database-unavailable',
					message: 'SQLite is unavailable; the repository was not deleted.',
					severity: 'error',
				});
			}

			const repositoryId =
				typeof request.repositoryId === 'string'
					? request.repositoryId.trim()
					: '';
			if (!repositoryId) {
				return failure({
					code: 'repository-id-required',
					message: 'A repository id is required to delete a repository.',
					severity: 'error',
				});
			}

			const source = readRepository(database, repositoryId);
			if (!source) {
				return failure({
					code: 'repository-not-found',
					message: `No repository is registered with id ${repositoryId}.`,
					severity: 'error',
				});
			}

			const diagnostics: DeleteRepositoryDiagnostic[] = [];

			for (const workspace of source.workspaces) {
				const worktreeOutcome = await runWorktreeRemove({
					localCommandService,
					repositoryPath: source.path,
					workspacePath: workspace.path,
				});
				if (worktreeOutcome.status === 'failure') {
					diagnostics.push({
						code: 'workspace-cleanup-failed',
						message: worktreeOutcome.message,
						path: workspace.path,
						severity: 'warning',
						workspaceId: workspace.id,
					});
				}

				removeWorkspaceDirectory({ diagnostics, workspace });

				if (workspace.branchName) {
					const branchOutcome = await runBranchDelete({
						branchName: workspace.branchName,
						localCommandService,
						repositoryPath: source.path,
					});
					if (branchOutcome.status === 'failure') {
						diagnostics.push({
							code: 'workspace-cleanup-failed',
							message: branchOutcome.message,
							severity: 'warning',
							workspaceId: workspace.id,
						});
					}
				}
			}

			try {
				deleteRepositoryRows({ database, repositoryId: source.id });
			} catch (error) {
				diagnostics.push({
					code: 'repository-delete-failed',
					message:
						error instanceof Error
							? error.message
							: 'Failed to delete the repository row.',
					severity: 'error',
				});
				return {
					diagnostics,
					repository: null,
					status: 'failure',
					workspacesDeleted: 0,
				};
			}

			writeArchivedMarker({ diagnostics, repositoryPath: source.path });

			removeArchivedContextsForRepository({
				diagnostics,
				rootDirectoryService,
				repositorySlug: source.slug,
			});

			const repository: DeletedRepositorySnapshot = {
				deletedWorkspaceIds: source.workspaces.map((w) => w.id),
				id: source.id,
				name: source.name,
				path: source.path,
			};

			return {
				diagnostics,
				repository,
				status: 'success',
				workspacesDeleted: source.workspaces.length,
			};
		},
	};
}

function readRepository(
	database: DatabaseSync,
	repositoryId: string,
): SourceRepository | null {
	const repositoryRow = selectRepositoryForDelete({
		database,
		id: repositoryId,
	});

	if (!isRepositoryRow(repositoryRow)) {
		return null;
	}

	const workspaceRows = listWorkspaceDeletionRowsByRepository({
		database,
		repositoryId,
	});

	const workspaces: SourceWorkspace[] = [];
	for (const row of workspaceRows) {
		if (isWorkspaceRow(row)) {
			workspaces.push(row);
		}
	}

	return {
		id: repositoryRow.id,
		name: repositoryRow.name,
		path: repositoryRow.path,
		slug: repositoryRow.slug,
		workspaces,
	};
}

function removeWorkspaceDirectory({
	diagnostics,
	workspace,
}: {
	diagnostics: DeleteRepositoryDiagnostic[];
	workspace: SourceWorkspace;
}): void {
	try {
		rmSync(workspace.path, { force: true, recursive: true });
	} catch (error) {
		if (existsSync(workspace.path)) {
			diagnostics.push({
				code: 'workspace-cleanup-failed',
				message:
					error instanceof Error
						? error.message
						: 'Failed to remove the workspace directory.',
				path: workspace.path,
				severity: 'warning',
				workspaceId: workspace.id,
			});
		}
	}
}

function deleteRepositoryRows({
	database,
	repositoryId,
}: {
	database: DatabaseSync;
	repositoryId: string;
}): void {
	withTransaction(database, () => {
		deleteWorkspaceRowsByRepository({ database, repositoryId });
		deleteRepositoryRowById({ database, id: repositoryId });
	});
}

function writeArchivedMarker({
	diagnostics,
	repositoryPath,
}: {
	diagnostics: DeleteRepositoryDiagnostic[];
	repositoryPath: string;
}): void {
	if (!existsSync(repositoryPath)) {
		return;
	}
	try {
		writeFileSync(
			path.join(repositoryPath, ARCHIVED_REPOSITORY_MARKER),
			`Removed by Ensemble.\nDelete this file to allow the repository to be re-adopted automatically.\n`,
		);
	} catch (error) {
		diagnostics.push({
			code: 'workspace-cleanup-failed',
			message:
				error instanceof Error
					? error.message
					: 'Failed to write the archive marker.',
			path: repositoryPath,
			severity: 'warning',
		});
	}
}

function failure(
	diagnostic: DeleteRepositoryDiagnostic,
): DeleteRepositoryResult {
	return {
		diagnostics: [diagnostic],
		repository: null,
		status: 'failure',
		workspacesDeleted: 0,
	};
}

function isRepositoryRow(row: unknown): row is {
	id: string;
	name: string;
	path: string;
	slug: string;
} {
	if (typeof row !== 'object' || row === null) {
		return false;
	}
	const candidate = row as Record<string, unknown>;
	return (
		typeof candidate.id === 'string' &&
		typeof candidate.name === 'string' &&
		typeof candidate.path === 'string' &&
		typeof candidate.slug === 'string'
	);
}

/**
 * Removes the repository's slice of the managed `archived-contexts/` tree.
 * Repository removal is destructive — any preserved `.context/` snapshots
 * under this repo's slug folder should disappear along with the workspace
 * rows. Errors surface as warnings; the row deletion has already succeeded.
 */
function removeArchivedContextsForRepository({
	diagnostics,
	repositorySlug,
	rootDirectoryService,
}: {
	diagnostics: DeleteRepositoryDiagnostic[];
	repositorySlug: string;
	rootDirectoryService: EnsembleRootDirectoryService;
}): void {
	const snapshot = rootDirectoryService.getSnapshot();
	if (!snapshot?.archivedContextsPath) {
		return;
	}
	const repositoryArchivePath = path.join(
		snapshot.archivedContextsPath,
		repositorySlug,
	);
	if (!existsSync(repositoryArchivePath)) {
		return;
	}
	try {
		rmSync(repositoryArchivePath, { force: true, recursive: true });
	} catch (error) {
		diagnostics.push({
			code: 'workspace-cleanup-failed',
			message:
				error instanceof Error
					? error.message
					: 'Failed to remove the archived-contexts directory for the repository.',
			path: repositoryArchivePath,
			severity: 'warning',
		});
	}
}

function isWorkspaceRow(row: unknown): row is SourceWorkspace {
	if (typeof row !== 'object' || row === null) {
		return false;
	}
	const candidate = row as Record<string, unknown>;
	return (
		typeof candidate.id === 'string' &&
		typeof candidate.name === 'string' &&
		typeof candidate.path === 'string' &&
		(candidate.branchName === null || typeof candidate.branchName === 'string')
	);
}

export type { DeleteRepositoryDiagnosticCode };
