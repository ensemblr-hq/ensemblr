import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type {
	DeletedRepositorySnapshot,
	DeleteRepositoryDiagnostic,
	DeleteRepositoryDiagnosticCode,
	DeleteRepositoryRequest,
	DeleteRepositoryResult,
} from '../../shared/ipc/contracts/repository';
import type { LocalCommandService } from '../commands/local-command';
import type { EnsemblrRootDirectoryService } from '../root';
import type { EnsemblrDatabaseService } from '../storage/database.ts';
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
	databaseService: EnsemblrDatabaseService;
	localCommandService: LocalCommandService;
	rootDirectoryService: EnsemblrRootDirectoryService;
}

/** In-memory shape of a repository and its workspaces loaded for deletion. */
interface SourceRepository {
	id: string;
	name: string;
	path: string;
	slug: string;
	workspaces: SourceWorkspace[];
}

/** In-memory shape of a workspace row loaded for repository deletion. */
interface SourceWorkspace {
	branchName: string | null;
	id: string;
	name: string;
	path: string;
}

/**
 * Builds the service that destructively removes a repository and every child
 * workspace from Ensemblr. Worktrees are wiped, branches are dropped, and the
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

/**
 * Load a repository and its workspaces from SQLite as the deletion source.
 * @param database - Open SQLite connection
 * @param repositoryId - ID of the repository to load
 * @returns The repository with its workspaces, or null when it is not registered
 */
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

/**
 * Remove a workspace's worktree directory, recording a warning diagnostic when it cannot be deleted.
 * @param options - Diagnostics sink and the workspace whose directory is removed
 */
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

/**
 * Delete a repository's workspace rows and its own row within one transaction.
 * @param options - Open database and the repository id whose rows are removed
 */
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

/**
 * Write the archived-repository sentinel into the repo folder so the shared-root reconciler does not re-adopt it.
 * @param options - Diagnostics sink and the repository path to mark
 */
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
			`Removed by Ensemblr.\nDelete this file to allow the repository to be re-adopted automatically.\n`,
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

/**
 * Wrap a single diagnostic into a failed delete-repository result.
 * @param diagnostic - The diagnostic explaining why the delete failed
 * @returns A failure result carrying the diagnostic
 */
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

/**
 * Narrow an unknown SQLite row to the repository fields required for deletion.
 * @param row - Candidate row returned by the query
 * @returns True when the row carries string id, name, path, and slug
 */
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
	rootDirectoryService: EnsemblrRootDirectoryService;
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

/**
 * Narrow an unknown SQLite row to a deletable {@link SourceWorkspace}.
 * @param row - Candidate row returned by the query
 * @returns True when the row has the required workspace fields
 */
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
