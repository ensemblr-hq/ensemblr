import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
	ArchivedRepositorySnapshot,
	ArchiveLifecycleDiagnostic,
	ArchiveRepositoryDiagnostic,
	ArchiveRepositoryDiagnosticCode,
	ArchiveRepositoryRequest,
	ArchiveRepositoryResult,
} from '../../shared/ipc';
import type { EnsembleDatabaseService } from '../storage/database.ts';
import type { ArchiveLifecycleService } from './archive-lifecycle.ts';
import type { ArchiveWorkspaceService } from './archive-workspace.ts';

/** Public surface of the repository lifecycle archive service. */
export interface ArchiveRepositoryService {
	archive: (
		request: ArchiveRepositoryRequest,
	) => Promise<ArchiveRepositoryResult>;
}

/** Options for {@link createArchiveRepositoryService}. */
export interface CreateArchiveRepositoryServiceOptions {
	archiveLifecycleService: ArchiveLifecycleService;
	archiveWorkspaceService: ArchiveWorkspaceService;
	databaseService: EnsembleDatabaseService;
	now?: () => Date;
}

interface SourceRepository {
	archivedAt: string | null;
	id: string;
	name: string;
	path: string;
	slug: string;
	workspaces: SourceWorkspace[];
}

interface SourceWorkspace {
	archivedAt: string | null;
	id: string;
	name: string;
}

/**
 * Builds the service that archives a repository as a lifecycle state. Each
 * unarchived child workspace is funnelled through the workspace archive
 * service (so it reuses the same hooks + `.context/` preservation), then the
 * repository row is stamped with `archived_at` and a repository-level row is
 * inserted into `archive_records`. Pre-/post-archive-repository hooks run
 * around the cascade.
 */
export function createArchiveRepositoryService({
	archiveLifecycleService,
	archiveWorkspaceService,
	databaseService,
	now = () => new Date(),
}: CreateArchiveRepositoryServiceOptions): ArchiveRepositoryService {
	return {
		archive: async (request) => {
			const database = databaseService.getConnection()?.database;
			if (!database) {
				return failure({
					code: 'database-unavailable',
					message: 'SQLite is unavailable; the repository was not archived.',
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
					message: 'A repository id is required to archive a repository.',
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

			if (source.archivedAt) {
				return failure({
					code: 'repository-already-archived',
					message: `Repository "${source.name}" was already archived at ${source.archivedAt}.`,
					severity: 'info',
				});
			}

			const branchCleanup = request.branchCleanup === true;
			const reason =
				typeof request.reason === 'string' && request.reason.trim()
					? request.reason.trim()
					: null;
			const archivedAt = now().toISOString();
			const diagnostics: ArchiveRepositoryDiagnostic[] = [];

			const preHookOutcome = await archiveLifecycleService.invoke(
				'pre-archive-repository',
				{
					archivedAt,
					archivedContextPath: null,
					branchCleanup,
					repository: {
						id: source.id,
						name: source.name,
						path: source.path,
						slug: source.slug,
					},
					workspace: null,
				},
			);
			pushLifecycleDiagnostics(diagnostics, preHookOutcome.diagnostics);

			if (preHookOutcome.aborted) {
				return {
					archiveRecordId: null,
					diagnostics: [
						...diagnostics,
						{
							code: 'archive-aborted-by-hook',
							message: preHookOutcome.aborted.message,
							severity: 'error',
						},
					],
					repository: null,
					status: 'aborted',
					workspacesArchived: 0,
				};
			}

			const archivedWorkspaceIds: string[] = [];
			let workspacesArchived = 0;
			let cascadeFailed = false;

			for (const workspace of source.workspaces) {
				if (workspace.archivedAt) {
					archivedWorkspaceIds.push(workspace.id);
					continue;
				}
				const workspaceResult = await archiveWorkspaceService.archive({
					branchCleanup,
					workspaceId: workspace.id,
					...(reason ? { reason } : {}),
				});

				for (const diagnostic of workspaceResult.diagnostics) {
					diagnostics.push({
						code:
							diagnostic.code === 'workspace-update-failed'
								? 'workspace-archive-failed'
								: 'workspace-archive-failed',
						message: `Workspace "${workspace.name}": ${diagnostic.message}`,
						path: diagnostic.path,
						severity: diagnostic.severity,
						workspaceId: workspace.id,
					});
				}

				if (workspaceResult.status === 'success') {
					archivedWorkspaceIds.push(workspace.id);
					workspacesArchived += 1;
					continue;
				}

				cascadeFailed = true;
				break;
			}

			if (cascadeFailed) {
				return {
					archiveRecordId: null,
					diagnostics,
					repository: null,
					status: 'failure',
					workspacesArchived,
				};
			}

			const recordId = `archive-${randomUUID()}`;

			try {
				stampArchivedAt({
					archivedAt,
					branchCleanup,
					database,
					reason,
					recordId,
					source,
				});
			} catch (error) {
				diagnostics.push({
					code: 'repository-update-failed',
					message:
						error instanceof Error
							? error.message
							: 'Failed to record the repository archive lifecycle row.',
					severity: 'error',
				});
				return {
					archiveRecordId: null,
					diagnostics,
					repository: null,
					status: 'failure',
					workspacesArchived,
				};
			}

			const postHookOutcome = await archiveLifecycleService.invoke(
				'post-archive-repository',
				{
					archivedAt,
					archivedContextPath: null,
					branchCleanup,
					repository: {
						id: source.id,
						name: source.name,
						path: source.path,
						slug: source.slug,
					},
					workspace: null,
				},
			);
			pushLifecycleDiagnostics(diagnostics, postHookOutcome.diagnostics);

			const repository: ArchivedRepositorySnapshot = {
				archivedAt,
				archivedWorkspaceIds,
				id: source.id,
				name: source.name,
				path: source.path,
				slug: source.slug,
			};

			return {
				archiveRecordId: recordId,
				diagnostics,
				repository,
				status: 'success',
				workspacesArchived,
			};
		},
	};
}

function readRepository(
	database: DatabaseSync,
	repositoryId: string,
): SourceRepository | null {
	const repositoryRow = database
		.prepare(
			`SELECT
				id AS id,
				slug AS slug,
				name AS name,
				path AS path,
				archived_at AS archivedAt
			FROM repositories
			WHERE id = ?`,
		)
		.get(repositoryId);

	if (!isRepositoryRow(repositoryRow)) {
		return null;
	}

	const workspaceRows = database
		.prepare(
			`SELECT
				id AS id,
				name AS name,
				archived_at AS archivedAt
			FROM workspaces
			WHERE repository_id = ?
			ORDER BY created_at`,
		)
		.all(repositoryId);

	const workspaces: SourceWorkspace[] = [];
	for (const row of workspaceRows) {
		if (isWorkspaceRow(row)) {
			workspaces.push(row);
		}
	}

	return { ...repositoryRow, workspaces };
}

function stampArchivedAt({
	archivedAt,
	branchCleanup,
	database,
	reason,
	recordId,
	source,
}: {
	archivedAt: string;
	branchCleanup: boolean;
	database: DatabaseSync;
	reason: string | null;
	recordId: string;
	source: SourceRepository;
}): void {
	database.exec('BEGIN');
	try {
		database
			.prepare(
				`UPDATE repositories
				SET archived_at = ?, updated_at = ?
				WHERE id = ?`,
			)
			.run(archivedAt, archivedAt, source.id);
		database
			.prepare(
				`INSERT INTO archive_records (
					id,
					record_type,
					repository_id,
					workspace_id,
					repository_slug,
					workspace_slug,
					branch_name,
					base_branch,
					source_path,
					archived_context_path,
					branch_cleanup,
					archive_reason,
					archived_at
				)
				VALUES (?, 'repository', ?, NULL, ?, NULL, NULL, NULL, ?, NULL, ?, ?, ?)`,
			)
			.run(
				recordId,
				source.id,
				source.slug,
				source.path,
				branchCleanup ? 1 : 0,
				reason,
				archivedAt,
			);
		database.exec('COMMIT');
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}
}

function pushLifecycleDiagnostics(
	diagnostics: ArchiveRepositoryDiagnostic[],
	lifecycle: ArchiveLifecycleDiagnostic[],
): void {
	for (const entry of lifecycle) {
		diagnostics.push({
			code: 'lifecycle-hook-failed',
			message: entry.message,
			path: entry.path,
			severity: entry.severity,
		});
	}
}

function failure(
	diagnostic: ArchiveRepositoryDiagnostic,
): ArchiveRepositoryResult {
	return {
		archiveRecordId: null,
		diagnostics: [diagnostic],
		repository: null,
		status: 'failure',
		workspacesArchived: 0,
	};
}

function isRepositoryRow(row: unknown): row is {
	archivedAt: string | null;
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
		typeof candidate.slug === 'string' &&
		typeof candidate.name === 'string' &&
		typeof candidate.path === 'string' &&
		(candidate.archivedAt === null || typeof candidate.archivedAt === 'string')
	);
}

function isWorkspaceRow(row: unknown): row is SourceWorkspace {
	if (typeof row !== 'object' || row === null) {
		return false;
	}
	const candidate = row as Record<string, unknown>;
	return (
		typeof candidate.id === 'string' &&
		typeof candidate.name === 'string' &&
		(candidate.archivedAt === null || typeof candidate.archivedAt === 'string')
	);
}

export type { ArchiveRepositoryDiagnosticCode };
