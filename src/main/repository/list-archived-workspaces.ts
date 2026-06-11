import type { DatabaseSync } from 'node:sqlite';

import type {
	ArchivedWorkspaceListEntry,
	ListArchivedWorkspacesRequest,
	ListArchivedWorkspacesResult,
} from '../../shared/ipc';
import type { EnsembleDatabaseService } from '../storage/database.ts';
import { listArchivedWorkspaceRowsByRepository } from '../storage/repositories/workspace-repository.ts';

/** Public surface of the archived workspace browser. */
export interface ListArchivedWorkspacesService {
	list: (
		request: ListArchivedWorkspacesRequest,
	) => Promise<ListArchivedWorkspacesResult>;
}

/** Options for {@link createListArchivedWorkspacesService}. */
export interface CreateListArchivedWorkspacesServiceOptions {
	databaseService: EnsembleDatabaseService;
}

/**
 * Builds the service that returns every archived workspace under a repository,
 * joined with the most recent `archive_records` row so the renderer can show
 * branch cleanup status, preserved context path, and base branch.
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

function toListEntry(row: unknown): ArchivedWorkspaceListEntry | null {
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
		typeof candidate.archivedAt !== 'string'
	) {
		return null;
	}
	return {
		archivedAt: candidate.archivedAt,
		archivedContextPath:
			typeof candidate.archivedContextPath === 'string'
				? candidate.archivedContextPath
				: null,
		archiveRecordId:
			typeof candidate.archiveRecordId === 'string'
				? candidate.archiveRecordId
				: null,
		baseBranch:
			typeof candidate.baseBranch === 'string' ? candidate.baseBranch : null,
		branchCleanup: candidate.branchCleanupRaw === 1,
		branchName:
			typeof candidate.branchName === 'string' ? candidate.branchName : null,
		id: candidate.id,
		name: candidate.name,
		path: candidate.path,
		repositoryId: candidate.repositoryId,
		slug: candidate.slug,
	};
}
