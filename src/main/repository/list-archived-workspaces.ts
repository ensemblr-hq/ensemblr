import type { DatabaseSync } from 'node:sqlite';

import type {
	ArchivedWorkspaceListEntry,
	ListArchivedWorkspacesRequest,
	ListArchivedWorkspacesResult,
} from '../../shared/ipc';
import type { EnsembleDatabaseService } from '../storage/database.ts';

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
	const rows = database
		.prepare(
			`SELECT
				w.id AS id,
				w.slug AS slug,
				w.repository_id AS repositoryId,
				w.name AS name,
				w.path AS path,
				w.branch_name AS branchName,
				w.archived_at AS archivedAt,
				a.id AS archiveRecordId,
				a.base_branch AS baseBranch,
				a.archived_context_path AS archivedContextPath,
				a.branch_cleanup AS branchCleanupRaw
			FROM workspaces w
			LEFT JOIN archive_records a
				ON a.workspace_id = w.id
				AND a.record_type = 'workspace'
				AND a.id = (
					SELECT id FROM archive_records
					WHERE workspace_id = w.id AND record_type = 'workspace'
					ORDER BY archived_at DESC
					LIMIT 1
				)
			WHERE w.repository_id = ? AND w.archived_at IS NOT NULL
			ORDER BY w.archived_at DESC`,
		)
		.all(repositoryId);

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
