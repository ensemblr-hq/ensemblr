import { existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

import type {
	ArchivedWorkspaceListEntry,
	ListArchivedWorkspacesRequest,
	ListArchivedWorkspacesResult,
} from '../../shared/ipc/contracts/workspace';
import type { EnsemblrDatabaseService } from '../storage';
import { listArchivedWorkspaceRowsByRepository } from '../storage/repositories/workspace-repository.ts';
import { readNullableString, readStringColumns } from './row-guards.ts';

/** Public surface of the archived workspace browser. */
export interface ListArchivedWorkspacesService {
	list: (
		request: ListArchivedWorkspacesRequest,
	) => Promise<ListArchivedWorkspacesResult>;
}

/** Options for {@link createListArchivedWorkspacesService}. */
export interface CreateListArchivedWorkspacesServiceOptions {
	databaseService: EnsemblrDatabaseService;
}

/**
 * Builds the service that returns every archived workspace under a repository,
 * joined with the most recent `archive_records` row so the renderer can show
 * branch cleanup status, preserved context path, base branch, and whether the
 * worktree still occupies disk.
 */
export function createListArchivedWorkspacesService({
	databaseService,
}: CreateListArchivedWorkspacesServiceOptions): ListArchivedWorkspacesService {
	return {
		list: async (request) => {
			const repositoryId =
				typeof request.repositoryId === 'string'
					? request.repositoryId.trim()
					: '';

			if (!repositoryId) {
				return { entries: [], repositoryId };
			}

			const database = databaseService.getConnection()?.database;
			if (!database) {
				return { entries: [], repositoryId };
			}

			const entries = readEntries(database, repositoryId);
			return { entries, repositoryId };
		},
	};
}

/**
 * Read a repository's archived workspace rows and map them to list entries, dropping malformed rows.
 * @param database - Open SQLite connection
 * @param repositoryId - ID of the repository whose archived workspaces are listed
 * @returns The mapped archived workspace entries
 */
function readEntries(
	database: DatabaseSync,
	repositoryId: string,
): ArchivedWorkspaceListEntry[] {
	const rows = listArchivedWorkspaceRowsByRepository({
		database,
		repositoryId,
	});

	const entries: ArchivedWorkspaceListEntry[] = [];
	for (const row of rows) {
		const entry = toListEntry(row);
		if (entry) {
			entries.push(entry);
		}
	}
	return entries;
}

/**
 * Map a raw SQLite row to an archived workspace list entry, or null when required fields are missing.
 * @param row - Candidate row returned by the query
 * @returns The list entry, or null when the row is malformed
 */
function toListEntry(row: unknown): ArchivedWorkspaceListEntry | null {
	const candidate = readStringColumns(row, [
		'archivedAt',
		'id',
		'name',
		'path',
		'repositoryId',
		'slug',
	]);
	if (!candidate) {
		return null;
	}
	return {
		archivedAt: candidate.archivedAt,
		archivedContextPath: readNullableString(candidate.archivedContextPath),
		archiveRecordId: readNullableString(candidate.archiveRecordId),
		baseBranch: readNullableString(candidate.baseBranch),
		branchCleanup: candidate.branchCleanupRaw === 1,
		branchName: readNullableString(candidate.branchName),
		id: candidate.id,
		name: candidate.name,
		path: candidate.path,
		// Probed rather than inferred from the prune flag: a worktree the user
		// deleted by hand, or one from an archive made before pruning existed, is
		// equally not there, and offering to reclaim it would be a dead button.
		pathExists: existsSync(candidate.path),
		repositoryId: candidate.repositoryId,
		slug: candidate.slug,
		worktreePruned: candidate.worktreePrunedRaw === 1,
	};
}
