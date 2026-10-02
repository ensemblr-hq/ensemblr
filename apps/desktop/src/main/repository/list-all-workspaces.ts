import type { DatabaseSync } from 'node:sqlite';

import type {
	ListAllWorkspacesResult,
	WorkspaceHistoryEntry,
} from '../../shared/ipc/contracts/workspace';
import type { EnsemblrDatabaseService } from '../storage';
import { listAllWorkspaceRows } from '../storage/repositories/workspace-repository.ts';
import { readNullableString, readStringColumns } from './row-guards.ts';

/** Public surface of the global workspace History feed. */
export interface ListAllWorkspacesService {
	list: () => Promise<ListAllWorkspacesResult>;
}

/** Options for {@link createListAllWorkspacesService}. */
export interface CreateListAllWorkspacesServiceOptions {
	databaseService: EnsemblrDatabaseService;
}

/**
 * Builds the service backing the History screen. Returns every workspace ever
 * created across all repositories — active and archived — joined with the
 * latest `archive_records` row so the renderer can render the row, group by
 * last activity, and gate the Unarchive action. Degrades to an empty list when
 * the database connection is unavailable.
 */
export function createListAllWorkspacesService({
	databaseService,
}: CreateListAllWorkspacesServiceOptions): ListAllWorkspacesService {
	return {
		list: async () => {
			const database = databaseService.getConnection()?.database;
			if (!database) {
				return { entries: [] };
			}

			return { entries: readEntries(database) };
		},
	};
}

/**
 * Read every workspace history row and map it to renderer entries, dropping malformed rows.
 * @param database - Open SQLite connection
 * @returns The mapped workspace history entries
 */
function readEntries(database: DatabaseSync): WorkspaceHistoryEntry[] {
	const rows = listAllWorkspaceRows({ database });

	const entries: WorkspaceHistoryEntry[] = [];
	for (const row of rows) {
		const entry = toEntry(row);
		if (entry) {
			entries.push(entry);
		}
	}
	return entries;
}

/**
 * Map a raw SQLite row to a workspace history entry, or null when required fields are missing.
 * @param row - Candidate row returned by the query
 * @returns The history entry, or null when the row is malformed
 */
function toEntry(row: unknown): WorkspaceHistoryEntry | null {
	const candidate = readStringColumns(row, [
		'createdAt',
		'id',
		'name',
		'path',
		'repositoryId',
		'repositoryName',
		'slug',
		'updatedAt',
	]);
	if (!candidate) {
		return null;
	}
	return {
		archivedAt: readNullableString(candidate.archivedAt),
		baseBranch: readNullableString(candidate.baseBranch),
		branchCleanup: candidate.branchCleanupRaw === 1,
		branchName: readNullableString(candidate.branchName),
		createdAt: candidate.createdAt,
		id: candidate.id,
		name: candidate.name,
		path: candidate.path,
		repositoryId: candidate.repositoryId,
		repositoryName: candidate.repositoryName,
		slug: candidate.slug,
		updatedAt: candidate.updatedAt,
		worktreePruned: candidate.worktreePrunedRaw === 1,
	};
}
