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
import {
	removeDirectoryTree,
	removeManagedDirectory,
} from './remove-directory.ts';
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
 * workspace from Ensemblr. Worktrees and SQLite rows are removed, but branch
 * deletion, private-ref cleanup and archive markers are restricted to managed
 * repositories. External project folders and their refs remain owned by the user.
 *
 * The repository folder itself is removed only when the request asks for it and
 * the folder lives inside the managed `repos/` root. A retained managed folder
 * gets a sentinel so the shared-root reconciler does not resurrect it.
 * @param options - Persistence, Git, managed-root and workspace teardown services.
 * @returns The repository removal service.
 */
export function createDeleteRepositoryService({
	databaseService,
	localCommandService,
	rootDirectoryService,
	workspaceTeardownService,
}: CreateDeleteRepositoryServiceOptions): DeleteRepositoryService {
	return {
		delete: (request) =>
			deleteRepository({
				databaseService,
				localCommandService,
				request,
				rootDirectoryService,
				workspaceTeardownService,
			}),
	};
}

/**
 * Removes a registered repository while retaining the ownership boundary between
 * Ensemblr-managed repositories and external projects.
 * @param options - The deletion request and services it needs to remove state.
 * @returns The deletion result with best-effort cleanup diagnostics.
 */
async function deleteRepository({
	databaseService,
	localCommandService,
	request,
	rootDirectoryService,
	workspaceTeardownService,
}: CreateDeleteRepositoryServiceOptions & {
	request: DeleteRepositoryRequest;
}): Promise<DeleteRepositoryResult> {
	const database = databaseService.getConnection()?.database;
	if (!database) {
		return failure({
			code: 'database-unavailable',
			message: 'SQLite is unavailable; the repository was not deleted.',
			severity: 'error',
		});
	}

	const repositoryId =
		typeof request.repositoryId === 'string' ? request.repositoryId.trim() : '';
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
	const ownershipRefusal = repositoryFolderRefusal({
		repositoryPath: source.path,
		rootDirectoryService,
	});

	for (const workspace of source.workspaces) {
		await removeManagedWorktree({
			diagnostics,
			localCommandService,
			repositoryPath: source.path,
			workspace,
			workspaceTeardownService,
		});
		if (ownershipRefusal === null) {
			await removeManagedRepositoryWorkspaceBranch({
				diagnostics,
				localCommandService,
				repositoryPath: source.path,
				workspace,
			});
		}
	}

	if (
		!removeApplicationRecords({
			database,
			diagnostics,
			repositoryId: source.id,
		})
	) {
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
		ownershipRefusal === null
			? await cleanUpManagedRepository({
					diagnostics,
					deleteFolder: request.deleteFolder === true,
					localCommandService,
					repositoryPath: source.path,
					rootDirectoryService,
				})
			: await preserveExternalRepositoryFolder({
					diagnostics,
					deleteFolder: request.deleteFolder === true,
					ownershipRefusal,
					repositoryPath: source.path,
				});

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
}

/**
 * Tears down an Ensemblr-managed worktree without touching its repository's
 * branches, private refs, folder, or archive marker.
 * @param options - Diagnostics, Git services, and the workspace to remove.
 */
async function removeManagedWorktree({
	diagnostics,
	localCommandService,
	repositoryPath,
	workspace,
	workspaceTeardownService,
}: {
	diagnostics: DeleteRepositoryDiagnostic[];
	localCommandService: LocalCommandService;
	repositoryPath: string;
	workspace: SourceWorkspace;
	workspaceTeardownService: WorkspaceTeardownService;
}): Promise<void> {
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

	const worktreeOutcome = await runWorktreeRemove({
		localCommandService,
		deletingWorkspace: true,
		repositoryPath,
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
}

/**
 * Deletes one workspace branch only for a repository Ensemblr owns.
 * @param options - Diagnostics, Git services, and the managed workspace branch.
 */
async function removeManagedRepositoryWorkspaceBranch({
	diagnostics,
	localCommandService,
	repositoryPath,
	workspace,
}: {
	diagnostics: DeleteRepositoryDiagnostic[];
	localCommandService: LocalCommandService;
	repositoryPath: string;
	workspace: SourceWorkspace;
}): Promise<void> {
	if (!workspace.branchName) {
		return;
	}

	const branchOutcome = await runBranchDelete({
		branchName: workspace.branchName,
		localCommandService,
		repositoryPath,
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

/**
 * Deletes application records after their managed worktrees have been removed.
 * @param options - Database, diagnostics sink, and repository identifier.
 * @returns Whether the database transaction completed.
 */
function removeApplicationRecords({
	database,
	diagnostics,
	repositoryId,
}: {
	database: DatabaseSync;
	diagnostics: DeleteRepositoryDiagnostic[];
	repositoryId: string;
}): boolean {
	try {
		deleteRepositoryRows({ database, repositoryId });
		return true;
	} catch (error) {
		diagnostics.push({
			code: 'repository-delete-failed',
			message:
				error instanceof Error
					? error.message
					: 'Failed to delete the repository row.',
			severity: 'error',
		});
		return false;
	}
}

/**
 * Cleans managed-only repository state while preserving the folder unless the
 * request explicitly removes it.
 * @param options - Managed repository cleanup services and deletion intent.
 * @returns Whether the managed repository folder was removed.
 */
async function cleanUpManagedRepository({
	diagnostics,
	deleteFolder,
	localCommandService,
	repositoryPath,
	rootDirectoryService,
}: {
	diagnostics: DeleteRepositoryDiagnostic[];
	deleteFolder: boolean;
	localCommandService: LocalCommandService;
	repositoryPath: string;
	rootDirectoryService: EnsemblrRootDirectoryService;
}): Promise<boolean> {
	const folderDeleted =
		deleteFolder &&
		(await removeRepositoryFolder({
			diagnostics,
			repositoryPath,
			rootDirectoryService,
		}));
	if (!folderDeleted) {
		await runEnsemblrRefPurge({ localCommandService, repositoryPath });
		writeArchivedMarker({ diagnostics, repositoryPath });
	}
	return folderDeleted;
}

/**
 * Reports an attempted external-folder deletion without deleting, moving, or
 * marking the user-owned project.
 * @param options - External repository path, deletion intent, and diagnostics.
 * @returns Always false because external folders remain user-owned.
 */
async function preserveExternalRepositoryFolder({
	diagnostics,
	deleteFolder,
	ownershipRefusal,
	repositoryPath,
}: {
	diagnostics: DeleteRepositoryDiagnostic[];
	deleteFolder: boolean;
	ownershipRefusal: string;
	repositoryPath: string;
}): Promise<boolean> {
	if (deleteFolder) {
		diagnostics.push({
			code: 'repository-folder-external',
			message: ownershipRefusal,
			path: repositoryPath,
			severity: 'warning',
		});
	}
	return false;
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

	const outcome = await removeManagedDirectory({
		candidatePath: directoryPath,
		expectedDepth: MANAGED_CHILD_DEPTH,
		root: snapshot.workspacesPath,
	});
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
 * Determines whether the project folder belongs to the managed repositories root.
 * @param options - Project path and the current managed-root service.
 * @returns The ownership refusal, or null when this is a managed repository.
 */
function repositoryFolderRefusal({
	repositoryPath,
	rootDirectoryService,
}: {
	repositoryPath: string;
	rootDirectoryService: EnsemblrRootDirectoryService;
}): string | null {
	const repositoriesPath = rootDirectoryService.getSnapshot()?.repositoriesPath;
	return repositoriesPath
		? containmentRefusal({
				candidatePath: repositoryPath,
				expectedDepth: MANAGED_CHILD_DEPTH,
				root: repositoriesPath,
			})
		: 'The managed repositories directory is unavailable, so the repository folder was left on disk.';
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
 * refusal is reported; external folders never receive an archive sentinel.
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
	const refusal = repositoryFolderRefusal({
		repositoryPath,
		rootDirectoryService,
	});

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

	const outcome = await removeManagedDirectory({
		candidatePath: repositoryArchivePath,
		expectedDepth: MANAGED_CHILD_DEPTH,
		root: snapshot.archivedContextsPath,
	});

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
