import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
	ArchivedRepositorySnapshot,
	ArchiveRepositoryDiagnostic,
	ArchiveRepositoryDiagnosticCode,
	ArchiveRepositoryRequest,
	ArchiveRepositoryResult,
} from '../../shared/ipc';
import type { EnsembleDatabaseService } from '../storage/database.ts';
import {
	selectRepositoryForArchive,
	stampRepositoryArchived,
} from '../storage/repositories/repository-row-repository.ts';
import { listWorkspaceIdsByRepository } from '../storage/repositories/workspace-repository.ts';
import { withTransaction } from '../storage/tx.ts';
import {
	failureResult,
	pushLifecycleDiagnostics,
} from './archive-diagnostics.ts';
import type { ArchiveLifecycleService } from './archive-lifecycle.ts';
import { insertArchiveRecord } from './archive-records.ts';
import type { ArchiveWorkspaceService } from './archive-workspace.ts';
import { isNullableString, isRecord, isString } from './row-guards.ts';

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
	const repositoryRow = selectRepositoryForArchive({
		database,
		id: repositoryId,
	});

	if (!isRepositoryRow(repositoryRow)) {
		return null;
	}

	const workspaceRows = listWorkspaceIdsByRepository({
		database,
		repositoryId,
	});

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
	withTransaction(database, () => {
		stampRepositoryArchived({ archivedAt, database, id: source.id });
		insertArchiveRecord({
			archivedAt,
			archivedContextPath: null,
			baseBranch: null,
			branchCleanup,
			branchName: null,
			database,
			kind: 'repository',
			reason,
			recordId,
			repositoryId: source.id,
			repositoryPath: source.path,
			repositorySlug: source.slug,
			workspaceId: null,
			workspacePath: null,
			workspaceSlug: null,
		});
	});
}

function failure(
	diagnostic: ArchiveRepositoryDiagnostic,
): ArchiveRepositoryResult {
	return failureResult(diagnostic, {
		archiveRecordId: null,
		repository: null,
		workspacesArchived: 0,
	});
}

function isRepositoryRow(row: unknown): row is {
	archivedAt: string | null;
	id: string;
	name: string;
	path: string;
	slug: string;
} {
	if (!isRecord(row)) {
		return false;
	}
	return (
		isString(row.id) &&
		isString(row.slug) &&
		isString(row.name) &&
		isString(row.path) &&
		isNullableString(row.archivedAt)
	);
}

function isWorkspaceRow(row: unknown): row is SourceWorkspace {
	if (!isRecord(row)) {
		return false;
	}
	return (
		isString(row.id) && isString(row.name) && isNullableString(row.archivedAt)
	);
}

export type { ArchiveRepositoryDiagnosticCode };
