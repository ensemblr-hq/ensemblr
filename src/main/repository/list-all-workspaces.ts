import type { DatabaseSync } from 'node:sqlite';

import type {
	ListAllWorkspacesResult,
	WorkspaceHistoryEntry,
} from '../../shared/ipc/contracts/workspace';
import type { EnsemblrDatabaseService } from '../storage/database.ts';
import { listAllWorkspaceRows } from '../storage/repositories/workspace-repository.ts';

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

function toEntry(row: unknown): WorkspaceHistoryEntry | null {
	if (typeof row !== 'object' || row === null) {
		return null;
	}
	const candidate = row as Record<string, unknown>;
	if (
		typeof candidate.id !== 'string' ||
		typeof candidate.slug !== 'string' ||
		typeof candidate.name !== 'string' ||
		typeof candidate.path !== 'string' ||
		typeof candidate.repositoryId !== 'string' ||
		typeof candidate.repositoryName !== 'string' ||
		typeof candidate.createdAt !== 'string' ||
		typeof candidate.updatedAt !== 'string'
	) {
		return null;
	}
	return {
		archivedAt:
			typeof candidate.archivedAt === 'string' ? candidate.archivedAt : null,
		baseBranch:
			typeof candidate.baseBranch === 'string' ? candidate.baseBranch : null,
		branchCleanup: candidate.branchCleanupRaw === 1,
		branchName:
			typeof candidate.branchName === 'string' ? candidate.branchName : null,
		createdAt: candidate.createdAt,
		id: candidate.id,
		name: candidate.name,
		path: candidate.path,
		repositoryId: candidate.repositoryId,
		repositoryName: candidate.repositoryName,
		slug: candidate.slug,
		updatedAt: candidate.updatedAt,
	};
}
