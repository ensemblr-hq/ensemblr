import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type {
	ArchivedWorkspaceSnapshot,
	ArchiveLifecycleDiagnostic,
	ArchiveWorkspaceDiagnostic,
	ArchiveWorkspaceDiagnosticCode,
	ArchiveWorkspaceRequest,
	ArchiveWorkspaceResult,
} from '../../shared/ipc';
import type { LocalCommandService } from '../commands/local-command';
import type { EnsembleRootDirectoryService } from '../root';
import type { EnsembleDatabaseService } from '../storage/database.ts';
import type { ArchiveLifecycleService } from './archive-lifecycle.ts';
import { runBranchDelete, runWorktreeRemove } from './git-ops.ts';

/** Public surface of the workspace lifecycle archive service. */
export interface ArchiveWorkspaceService {
	archive: (
		request: ArchiveWorkspaceRequest,
	) => Promise<ArchiveWorkspaceResult>;
}

/** Options for {@link createArchiveWorkspaceService}. */
export interface CreateArchiveWorkspaceServiceOptions {
	archiveLifecycleService: ArchiveLifecycleService;
	databaseService: EnsembleDatabaseService;
	localCommandService: LocalCommandService;
	now?: () => Date;
	rootDirectoryService: EnsembleRootDirectoryService;
}

/** Workspace + repository fields the lifecycle archive needs in one read. */
interface SourceWorkspace {
	archivedAt: string | null;
	baseBranch: string | null;
	branchName: string | null;
	id: string;
	name: string;
	path: string;
	repositoryId: string;
	repositoryName: string;
	repositoryPath: string;
	repositorySlug: string;
	slug: string;
}

const CONTEXT_DIRECTORY = '.context';
const ARCHIVE_METADATA_FILENAME = 'archive-metadata.json';

/**
 * Builds the service that archives a workspace as a lifecycle state. Sets
 * `workspaces.archived_at`, preserves the workspace `.context/` under
 * `<root>/archived-contexts/<repo-slug>/<workspace-slug>-<timestamp>/`, writes
 * an `archive-metadata.json` snapshot, and inserts a row into `archive_records`
 * so PID-038 / PID-060 subscribers have enough state to act on later. Branch
 * cleanup runs only when the request opts in.
 */
export function createArchiveWorkspaceService({
	archiveLifecycleService,
	databaseService,
	localCommandService,
	now = () => new Date(),
	rootDirectoryService,
}: CreateArchiveWorkspaceServiceOptions): ArchiveWorkspaceService {
	return {
		archive: async (request) => {
			const database = databaseService.getConnection()?.database;
			if (!database) {
				return failure({
					code: 'database-unavailable',
					message: 'SQLite is unavailable; the workspace was not archived.',
					severity: 'error',
				});
			}

			const workspaceId =
				typeof request.workspaceId === 'string'
					? request.workspaceId.trim()
					: '';
			if (!workspaceId) {
				return failure({
					code: 'workspace-id-required',
					message: 'A workspace id is required to archive a workspace.',
					severity: 'error',
				});
			}

			const source = readWorkspace(database, workspaceId);
			if (!source) {
				return failure({
					code: 'workspace-not-found',
					message: `No workspace is registered with id ${workspaceId}.`,
					severity: 'error',
				});
			}

			if (source.archivedAt) {
				return failure({
					code: 'workspace-already-archived',
					message: `Workspace "${source.name}" was already archived at ${source.archivedAt}.`,
					severity: 'info',
				});
			}

			const rootSnapshot =
				rootDirectoryService.getSnapshot() ?? rootDirectoryService.ensure();
			if (!rootSnapshot.archivedContextsPath) {
				return failure({
					code: 'archived-contexts-directory-missing',
					message:
						'The managed root has no archived-contexts path; configure the root directory first.',
					severity: 'error',
				});
			}

			const branchCleanup = request.branchCleanup === true;
			const reason =
				typeof request.reason === 'string' && request.reason.trim()
					? request.reason.trim()
					: null;
			const archivedAt = now().toISOString();
			const diagnostics: ArchiveWorkspaceDiagnostic[] = [];

			const preserved = preserveContextDirectory({
				archivedAt,
				archivedContextsRoot: rootSnapshot.archivedContextsPath,
				diagnostics,
				source,
			});

			const preHookOutcome = await archiveLifecycleService.invoke(
				'pre-archive-workspace',
				{
					archivedAt,
					archivedContextPath: preserved.archivedContextPath,
					branchCleanup,
					repository: {
						id: source.repositoryId,
						name: source.repositoryName,
						path: source.repositoryPath,
						slug: source.repositorySlug,
					},
					workspace: {
						branchName: source.branchName,
						id: source.id,
						name: source.name,
						path: source.path,
						repositoryId: source.repositoryId,
						slug: source.slug,
					},
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
					status: 'aborted',
					workspace: null,
				};
			}

			const recordId = `archive-${randomUUID()}`;

			// Stamp the database before touching the filesystem so a crash in
			// the destructive git steps below leaves the workspace correctly
			// flagged as archived (with warnings) rather than live + worktreeless.
			try {
				stampArchivedAt({
					archivedAt,
					database,
					recordId,
					reason,
					source,
					archivedContextPath: preserved.archivedContextPath,
					branchCleanup,
				});
			} catch (error) {
				diagnostics.push({
					code: 'workspace-update-failed',
					message:
						error instanceof Error
							? error.message
							: 'Failed to record the archive lifecycle row.',
					severity: 'error',
				});
				return {
					archiveRecordId: null,
					diagnostics,
					status: 'failure',
					workspace: null,
				};
			}

			let branchDeleted = false;
			if (branchCleanup && source.branchName) {
				// Worktree first so `git branch -D` can drop the now-unchecked-out
				// branch. .context/ files were already copied into
				// archived-contexts/ above, so losing the worktree directory does
				// not lose any handoff state.
				const worktreeOutcome = await runWorktreeRemove({
					localCommandService,
					repositoryPath: source.repositoryPath,
					workspacePath: source.path,
				});
				if (worktreeOutcome.status === 'failure') {
					diagnostics.push({
						code: 'branch-cleanup-failed',
						message: worktreeOutcome.message,
						path: source.path,
						severity: 'warning',
					});
				}

				const branchOutcome = await runBranchDelete({
					branchName: source.branchName,
					localCommandService,
					repositoryPath: source.repositoryPath,
				});
				if (branchOutcome.status === 'success') {
					branchDeleted = true;
				} else if (branchOutcome.status === 'failure') {
					diagnostics.push({
						code: 'branch-cleanup-failed',
						message: branchOutcome.message,
						severity: 'warning',
					});
				}
			}

			if (preserved.archivedContextPath) {
				writeArchiveMetadata({
					archiveRecordId: recordId,
					archivedAt,
					branchCleanup,
					branchDeleted,
					diagnostics,
					preservedDirectory: preserved.archivedContextPath,
					reason,
					source,
				});
			}

			const postHookOutcome = await archiveLifecycleService.invoke(
				'post-archive-workspace',
				{
					archivedAt,
					archivedContextPath: preserved.archivedContextPath,
					branchCleanup,
					repository: {
						id: source.repositoryId,
						name: source.repositoryName,
						path: source.repositoryPath,
						slug: source.repositorySlug,
					},
					workspace: {
						branchName: source.branchName,
						id: source.id,
						name: source.name,
						path: source.path,
						repositoryId: source.repositoryId,
						slug: source.slug,
					},
				},
			);
			pushLifecycleDiagnostics(diagnostics, postHookOutcome.diagnostics);

			const workspace: ArchivedWorkspaceSnapshot = {
				archivedAt,
				archivedContextPath: preserved.archivedContextPath,
				branchCleanup,
				branchDeleted,
				branchName: source.branchName,
				id: source.id,
				name: source.name,
				path: source.path,
				repositoryId: source.repositoryId,
				slug: source.slug,
			};

			return {
				archiveRecordId: recordId,
				diagnostics,
				status: 'success',
				workspace,
			};
		},
	};
}

function readWorkspace(
	database: DatabaseSync,
	workspaceId: string,
): SourceWorkspace | null {
	const row = database
		.prepare(
			`SELECT
				w.id AS id,
				w.slug AS slug,
				w.repository_id AS repositoryId,
				w.name AS name,
				w.path AS path,
				w.branch_name AS branchName,
				w.base_branch AS baseBranch,
				w.archived_at AS archivedAt,
				r.path AS repositoryPath,
				r.name AS repositoryName,
				r.slug AS repositorySlug
			FROM workspaces w
			INNER JOIN repositories r ON r.id = w.repository_id
			WHERE w.id = ?`,
		)
		.get(workspaceId);

	if (!isWorkspaceRow(row)) {
		return null;
	}
	return row;
}

/**
 * Copies the workspace `.context/` directory (when present) into
 * `<archived-contexts>/<repo-slug>/<workspace-slug>-<timestamp>/.context/`.
 * Records a diagnostic when the copy fails; returns `archivedContextPath: null`
 * so the lifecycle continues even if the user already wiped the directory.
 */
function preserveContextDirectory({
	archivedAt,
	archivedContextsRoot,
	diagnostics,
	source,
}: {
	archivedAt: string;
	archivedContextsRoot: string;
	diagnostics: ArchiveWorkspaceDiagnostic[];
	source: SourceWorkspace;
}): { archivedContextPath: string | null } {
	const directoryName = `${source.slug}-${toFilesystemTimestamp(archivedAt)}`;
	const archivedContextPath = path.join(
		archivedContextsRoot,
		source.repositorySlug,
		directoryName,
	);

	if (existsSync(archivedContextPath)) {
		diagnostics.push({
			code: 'archived-context-already-exists',
			message: `Archived context destination already exists: ${archivedContextPath}.`,
			path: archivedContextPath,
			severity: 'warning',
		});
		return { archivedContextPath: null };
	}

	try {
		mkdirSync(archivedContextPath, { recursive: true });
	} catch (error) {
		diagnostics.push({
			code: 'archived-context-copy-failed',
			message:
				error instanceof Error
					? error.message
					: 'Failed to create the archived-context destination.',
			path: archivedContextPath,
			severity: 'warning',
		});
		return { archivedContextPath: null };
	}

	const sourceContextDir = path.join(source.path, CONTEXT_DIRECTORY);
	if (!existsSync(sourceContextDir)) {
		// No handoff context to preserve; the archive-metadata.json alone is
		// enough provenance for the lifecycle record.
		return { archivedContextPath };
	}

	try {
		cpSync(
			sourceContextDir,
			path.join(archivedContextPath, CONTEXT_DIRECTORY),
			{
				dereference: false,
				errorOnExist: false,
				force: true,
				preserveTimestamps: true,
				recursive: true,
				verbatimSymlinks: true,
			},
		);
	} catch (error) {
		diagnostics.push({
			code: 'archived-context-copy-failed',
			message:
				error instanceof Error
					? error.message
					: 'Failed to preserve the workspace .context directory.',
			path: sourceContextDir,
			severity: 'warning',
		});
	}

	return { archivedContextPath };
}

function stampArchivedAt({
	archivedAt,
	archivedContextPath,
	branchCleanup,
	database,
	reason,
	recordId,
	source,
}: {
	archivedAt: string;
	archivedContextPath: string | null;
	branchCleanup: boolean;
	database: DatabaseSync;
	reason: string | null;
	recordId: string;
	source: SourceWorkspace;
}): void {
	database.exec('BEGIN');
	try {
		database
			.prepare(
				`UPDATE workspaces
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
				VALUES (?, 'workspace', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				recordId,
				source.repositoryId,
				source.id,
				source.repositorySlug,
				source.slug,
				source.branchName,
				source.baseBranch,
				source.path,
				archivedContextPath,
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

function writeArchiveMetadata({
	archiveRecordId,
	archivedAt,
	branchCleanup,
	branchDeleted,
	diagnostics,
	preservedDirectory,
	reason,
	source,
}: {
	archiveRecordId: string;
	archivedAt: string;
	branchCleanup: boolean;
	branchDeleted: boolean;
	diagnostics: ArchiveWorkspaceDiagnostic[];
	preservedDirectory: string;
	reason: string | null;
	source: SourceWorkspace;
}): void {
	const payload = {
		archiveRecordId,
		archivedAt,
		branchCleanup,
		branchDeleted,
		ensembleSchema: 'archive-record/v1',
		reason,
		repository: {
			id: source.repositoryId,
			name: source.repositoryName,
			path: source.repositoryPath,
			slug: source.repositorySlug,
		},
		workspace: {
			baseBranch: source.baseBranch,
			branchName: source.branchName,
			id: source.id,
			name: source.name,
			path: source.path,
			slug: source.slug,
		},
	};

	try {
		writeFileSync(
			path.join(preservedDirectory, ARCHIVE_METADATA_FILENAME),
			`${JSON.stringify(payload, null, 2)}\n`,
			'utf8',
		);
	} catch (error) {
		diagnostics.push({
			code: 'archived-context-copy-failed',
			message:
				error instanceof Error
					? error.message
					: 'Failed to write archive-metadata.json into the archived-contexts directory.',
			path: preservedDirectory,
			severity: 'warning',
		});
	}
}

function pushLifecycleDiagnostics(
	diagnostics: ArchiveWorkspaceDiagnostic[],
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

/** Renders an ISO timestamp into a filesystem-safe suffix. */
function toFilesystemTimestamp(isoTimestamp: string): string {
	return isoTimestamp.replace(/[:.]/g, '-');
}

function failure(
	diagnostic: ArchiveWorkspaceDiagnostic,
): ArchiveWorkspaceResult {
	return {
		archiveRecordId: null,
		diagnostics: [diagnostic],
		status: 'failure',
		workspace: null,
	};
}

function isWorkspaceRow(row: unknown): row is SourceWorkspace {
	if (typeof row !== 'object' || row === null) {
		return false;
	}
	const candidate = row as Record<string, unknown>;
	return (
		typeof candidate.id === 'string' &&
		typeof candidate.slug === 'string' &&
		typeof candidate.name === 'string' &&
		typeof candidate.path === 'string' &&
		typeof candidate.repositoryId === 'string' &&
		typeof candidate.repositoryName === 'string' &&
		typeof candidate.repositoryPath === 'string' &&
		typeof candidate.repositorySlug === 'string' &&
		(candidate.branchName === null ||
			typeof candidate.branchName === 'string') &&
		(candidate.baseBranch === null ||
			typeof candidate.baseBranch === 'string') &&
		(candidate.archivedAt === null || typeof candidate.archivedAt === 'string')
	);
}

export type { ArchiveWorkspaceDiagnosticCode };
