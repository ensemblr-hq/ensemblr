import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type {
	DeletedRepositorySnapshot,
	DeleteRepositoryDiagnostic,
	DeleteRepositoryDiagnosticCode,
	DeleteRepositoryRequest,
	DeleteRepositoryResult,
} from '../../shared/ipc/contracts/repository';
import { MANAGED_CHILD_DEPTH } from '../../shared/managed-path.ts';
import type { LocalCommandService } from '../commands/local-command';
import { deleteRepositoryInfisicalLinks } from '../infisical/infisical-link-store.ts';
import type { EnsemblrRootDirectoryService } from '../root';
import type { EnsemblrDatabaseService } from '../storage';
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
import {
	runBranchDelete,
	runEnsemblrRefPurge,
	runWorktreeRemove,
} from './git-ops.ts';
import { deleteCachedRepositoryIssues } from './issue-cache.ts';
import { containmentRefusal } from './managed-path.ts';
import { removeDirectoryTree } from './remove-directory.ts';
import type { WorkspaceTeardownService } from './workspace-teardown.ts';

/** Public surface of the repository delete (destructive) service. */
export interface DeleteRepositoryService {
	delete: (request: DeleteRepositoryRequest) => Promise<DeleteRepositoryResult>;
}

/** Options for {@link createDeleteRepositoryService}. */
export interface CreateDeleteRepositoryServiceOptions {
	databaseService: EnsemblrDatabaseService;
	localCommandService: LocalCommandService;
	rootDirectoryService: EnsemblrRootDirectoryService;
	workspaceTeardownService: WorkspaceTeardownService;
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
 * workspace from Ensemblr. Worktrees are wiped, branches are dropped, the
 * SQLite rows are deleted, and the repository's leftover workspace directory is
 * cleared.
 *
 * The repository folder itself is removed only when the request asks for it and
 * the folder lives inside the managed `repos/` root; otherwise it is left in
 * place and tagged with a sentinel so the shared-root reconciler does not
 * resurrect it.
 */
export function createDeleteRepositoryService({
	databaseService,
	localCommandService,
	rootDirectoryService,
	workspaceTeardownService,
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
				const teardown = await workspaceTeardownService.teardown({
					workspaceId: workspace.id,
					workspacePath: workspace.path,
				});
				for (const message of teardown.failures) {
					diagnostics.push({
						code: 'workspace-cleanup-failed',
						message,
						severity: 'warning',
						workspaceId: workspace.id,
					});
				}

				// The whole repository is going, so a `git worktree lock` on one of its
				// workspaces is unlocked rather than worked around.
				const worktreeOutcome = await runWorktreeRemove({
					localCommandService,
					deletingWorkspace: true,
					repositoryPath: source.path,
					workspacePath: workspace.path,
				});
				if (worktreeOutcome.status !== 'success') {
					diagnostics.push({
						code: 'workspace-cleanup-failed',
						message: worktreeOutcome.message,
						path: workspace.path,
						severity: 'warning',
						workspaceId: workspace.id,
					});
				}

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

			await removeWorkspacesDirectory({
				diagnostics,
				repositorySlug: source.slug,
				rootDirectoryService,
			});

			const folderDeleted =
				request.deleteFolder === true &&
				(await removeRepositoryFolder({
					diagnostics,
					repositoryPath: source.path,
					rootDirectoryService,
				}));

			if (!folderDeleted) {
				// The refs only need purging while a `.git` survives to hold them, and
				// only then is the sentinel what stops the next launch re-adopting the
				// folder as a brand-new repository.
				await runEnsemblrRefPurge({
					localCommandService,
					repositoryPath: source.path,
				});
				writeArchivedMarker({ diagnostics, repositoryPath: source.path });
			}

			await removeArchivedContextsForRepository({
				diagnostics,
				rootDirectoryService,
				repositorySlug: source.slug,
			});

			const repository: DeletedRepositorySnapshot = {
				deletedWorkspaceIds: source.workspaces.map((w) => w.id),
				folderDeleted,
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
 * Delete a repository's workspace rows, its cached issue lists, its Infisical
 * link, and its own row within one transaction. Neither `integration_metadata`
 * nor `infisical_links` has a foreign key back to `repositories`, so both
 * outlive the repository unless they are dropped here.
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
		deleteCachedRepositoryIssues({ database, repositoryId });
		deleteRepositoryInfisicalLinks({ database, repositoryId });
		deleteRepositoryRowById({ database, id: repositoryId });
	});
}

/**
 * Removes the repository's folder under the managed workspaces root, which
 * holds whatever the per-workspace worktree removals left behind.
 *
 * Wholesale rather than per-directory, and that is the point: the startup sweep
 * refuses any leftover holding a `.git` — permanently — so a workspace whose
 * `git worktree remove` failed is residue nothing else can ever reclaim. Every
 * row under this slug has just been deleted, so there is nothing left here to
 * protect. Slugs are unique across live rows, so the path is unambiguous now
 * and would not stay so if this were deferred.
 * @param options - Diagnostics sink, the repository slug, and the root service
 */
async function removeWorkspacesDirectory({
	diagnostics,
	repositorySlug,
	rootDirectoryService,
}: {
	diagnostics: DeleteRepositoryDiagnostic[];
	repositorySlug: string;
	rootDirectoryService: EnsemblrRootDirectoryService;
}): Promise<void> {
	const snapshot = rootDirectoryService.getSnapshot();
	if (!snapshot?.workspacesPath) {
		return;
	}

	const directoryPath = path.join(snapshot.workspacesPath, repositorySlug);
	if (!existsSync(directoryPath)) {
		return;
	}

	const refusal = containmentRefusal({
		candidatePath: directoryPath,
		expectedDepth: MANAGED_CHILD_DEPTH,
		root: snapshot.workspacesPath,
	});
	if (refusal !== null) {
		diagnostics.push({
			code: 'workspace-cleanup-failed',
			message: refusal,
			path: directoryPath,
			severity: 'warning',
		});
		return;
	}

	const outcome = await removeDirectoryTree(directoryPath);
	if (!outcome.removed) {
		diagnostics.push({
			code: 'workspace-cleanup-failed',
			message:
				outcome.error ??
				'Failed to remove the workspaces directory for the repository.',
			path: directoryPath,
			severity: 'warning',
		});
	}
}

/**
 * Removes the repository folder itself, but only when it lives inside the
 * managed `repos/` root.
 *
 * Nothing recorded on the row distinguishes a repository Ensemblr cloned from
 * one the user registered in place, so realpath containment is the only test
 * that separates a folder Ensemblr owns from the user's own checkout. It
 * resolves both sides, so neither a row pointing through a symlink nor a
 * symlink planted in `repos/` can walk the removal out of the managed tree. A
 * refusal is reported and the caller falls back to the sentinel.
 * @param options - Diagnostics sink, the repository path, and the root service
 * @returns True when the folder is gone
 */
async function removeRepositoryFolder({
	diagnostics,
	repositoryPath,
	rootDirectoryService,
}: {
	diagnostics: DeleteRepositoryDiagnostic[];
	repositoryPath: string;
	rootDirectoryService: EnsemblrRootDirectoryService;
}): Promise<boolean> {
	const snapshot = rootDirectoryService.getSnapshot();
	const repositoriesPath = snapshot?.repositoriesPath;

	const refusal = repositoriesPath
		? containmentRefusal({
				candidatePath: repositoryPath,
				expectedDepth: MANAGED_CHILD_DEPTH,
				root: repositoriesPath,
			})
		: 'The managed repositories directory is unavailable, so the repository folder was left on disk.';

	if (refusal !== null) {
		diagnostics.push({
			code: 'repository-folder-external',
			message: refusal,
			path: repositoryPath,
			severity: 'warning',
		});
		return false;
	}

	if (!existsSync(repositoryPath)) {
		return true;
	}

	const outcome = await removeDirectoryTree(repositoryPath);
	if (!outcome.removed) {
		diagnostics.push({
			code: 'repository-folder-delete-failed',
			message:
				outcome.error ?? 'Failed to remove the repository folder from disk.',
			path: repositoryPath,
			severity: 'warning',
		});
	}

	return outcome.removed;
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
async function removeArchivedContextsForRepository({
	diagnostics,
	repositorySlug,
	rootDirectoryService,
}: {
	diagnostics: DeleteRepositoryDiagnostic[];
	repositorySlug: string;
	rootDirectoryService: EnsemblrRootDirectoryService;
}): Promise<void> {
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

	const outcome = await removeDirectoryTree(repositoryArchivePath);

	if (outcome.error !== null || !outcome.removed) {
		diagnostics.push({
			code: 'workspace-cleanup-failed',
			message:
				outcome.error ??
				'Failed to remove the archived-contexts directory for the repository.',
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
