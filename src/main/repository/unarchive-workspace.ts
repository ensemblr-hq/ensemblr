import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type {
	UnarchivedWorkspaceSnapshot,
	UnarchiveWorkspaceDiagnostic,
	UnarchiveWorkspaceDiagnosticCode,
	UnarchiveWorkspaceRequest,
	UnarchiveWorkspaceResult,
} from '../../shared/ipc/contracts/workspace';
import type { LocalCommandService } from '../commands/local-command';
import type { EnsembleDatabaseService } from '../storage/database.ts';
import {
	clearWorkspaceArchived,
	selectArchivedWorkspaceJoinById,
} from '../storage/repositories/workspace-repository.ts';
import { withTransaction } from '../storage/tx.ts';
import {
	failureResult,
	pushLifecycleDiagnostics,
} from './archive-diagnostics.ts';
import type { ArchiveLifecycleService } from './archive-lifecycle.ts';
import { runWorktreeAdd as runWorktreeAddShared } from './git-ops.ts';
import {
	hasWorkspaceRepositoryIdentity,
	isNullableNumber,
	isNullableString,
	isRecord,
} from './row-guards.ts';

/** Public surface of the workspace unarchive service. */
export interface UnarchiveWorkspaceService {
	unarchive: (
		request: UnarchiveWorkspaceRequest,
	) => Promise<UnarchiveWorkspaceResult>;
}

/** Options for {@link createUnarchiveWorkspaceService}. */
export interface CreateUnarchiveWorkspaceServiceOptions {
	archiveLifecycleService: ArchiveLifecycleService;
	databaseService: EnsembleDatabaseService;
	localCommandService: LocalCommandService;
	now?: () => Date;
}

/** Archived workspace state needed to drive the reverse lifecycle. */
interface ArchivedWorkspace {
	archivedAt: string | null;
	archivedContextPath: string | null;
	archiveRecordId: string | null;
	baseBranch: string | null;
	branchCleanup: boolean;
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

/**
 * Builds the service that reverses a workspace lifecycle archive. NULLs
 * `archived_at`, restores the preserved `.context/` directory back into the
 * worktree, and re-runs lifecycle hooks. When the original archive recorded
 * `branch_cleanup = 1` (worktree + branch already destroyed), the service
 * recreates the worktree from the recorded base branch before restoring
 * context.
 */
export function createUnarchiveWorkspaceService({
	archiveLifecycleService,
	databaseService,
	localCommandService,
	now = () => new Date(),
}: CreateUnarchiveWorkspaceServiceOptions): UnarchiveWorkspaceService {
	return {
		unarchive: async (request) => {
			const database = databaseService.getConnection()?.database;
			if (!database) {
				return failure({
					code: 'database-unavailable',
					message: 'SQLite is unavailable; the workspace was not unarchived.',
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
					message: 'A workspace id is required to unarchive a workspace.',
					severity: 'error',
				});
			}

			const source = readArchivedWorkspace(database, workspaceId);
			if (!source) {
				return failure({
					code: 'workspace-not-found',
					message: `No workspace is registered with id ${workspaceId}.`,
					severity: 'error',
				});
			}

			if (!source.archivedAt) {
				return failure({
					code: 'workspace-not-archived',
					message: `Workspace "${source.name}" is not archived.`,
					severity: 'info',
				});
			}
			const archivedAt = source.archivedAt;

			const diagnostics: UnarchiveWorkspaceDiagnostic[] = [];
			const unarchivedAt = now().toISOString();

			const preHookOutcome = await archiveLifecycleService.invoke(
				'pre-unarchive-workspace',
				{
					archivedAt,
					archivedContextPath: source.archivedContextPath,
					branchCleanup: source.branchCleanup,
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
					diagnostics: [
						...diagnostics,
						{
							code: 'unarchive-aborted-by-hook',
							message: preHookOutcome.aborted.message,
							severity: 'error',
						},
					],
					status: 'aborted',
					workspace: null,
				};
			}

			let branchRecreated = false;
			if (source.branchCleanup) {
				if (!source.archiveRecordId) {
					return failure({
						code: 'archive-record-missing',
						message:
							'No archive record was found for this workspace; the original worktree path cannot be recreated.',
						severity: 'error',
					});
				}
				if (!source.branchName) {
					return failure({
						code: 'base-branch-missing',
						message:
							'The archived branch name was not preserved; the worktree cannot be recreated.',
						severity: 'error',
					});
				}
				if (!source.baseBranch) {
					return failure({
						code: 'base-branch-missing',
						message:
							'The base branch was not preserved in the archive record; the worktree cannot be recreated.',
						severity: 'error',
					});
				}

				const recreateDiagnostic = await runWorktreeAdd({
					baseBranch: source.baseBranch,
					branchName: source.branchName,
					localCommandService,
					repositoryPath: source.repositoryPath,
					workspacePath: source.path,
				});
				if (recreateDiagnostic) {
					diagnostics.push(recreateDiagnostic);
					return {
						diagnostics,
						status: 'failure',
						workspace: null,
					};
				}
				branchRecreated = true;
			} else if (!existsSync(source.path)) {
				return failure({
					code: 'worktree-recreate-failed',
					message: `Worktree path is missing on disk: ${source.path}. Run delete-from-archive to clean up the orphaned record.`,
					path: source.path,
					severity: 'error',
				});
			}

			// Clear archived_at before restoring .context/ so a failed file copy
			// leaves the row in the live state (with a warning), not in a
			// half-archived state with restored context on disk.
			try {
				clearArchivedAt({ database, unarchivedAt, workspaceId: source.id });
			} catch (error) {
				diagnostics.push({
					code: 'workspace-update-failed',
					message:
						error instanceof Error
							? error.message
							: 'Failed to clear archived_at.',
					severity: 'error',
				});
				return {
					diagnostics,
					status: 'failure',
					workspace: null,
				};
			}

			const contextRestored = restoreContextDirectory({
				diagnostics,
				source,
			});

			const postHookOutcome = await archiveLifecycleService.invoke(
				'post-unarchive-workspace',
				{
					archivedAt,
					archivedContextPath: source.archivedContextPath,
					branchCleanup: source.branchCleanup,
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

			const workspace: UnarchivedWorkspaceSnapshot = {
				branchName: source.branchName,
				branchRecreated,
				contextRestored,
				id: source.id,
				name: source.name,
				path: source.path,
				repositoryId: source.repositoryId,
				slug: source.slug,
				unarchivedAt,
			};

			return {
				diagnostics,
				status: 'success',
				workspace,
			};
		},
	};
}

function readArchivedWorkspace(
	database: DatabaseSync,
	workspaceId: string,
): ArchivedWorkspace | null {
	const row = selectArchivedWorkspaceJoinById({ database, workspaceId });

	if (!isWorkspaceRow(row)) {
		return null;
	}

	return {
		archivedAt: row.archivedAt,
		archivedContextPath: row.archivedContextPath,
		archiveRecordId: row.archiveRecordId,
		baseBranch: row.baseBranch,
		branchCleanup: row.branchCleanupRaw === 1,
		branchName: row.branchName,
		id: row.id,
		name: row.name,
		path: row.path,
		repositoryId: row.repositoryId,
		repositoryName: row.repositoryName,
		repositoryPath: row.repositoryPath,
		repositorySlug: row.repositorySlug,
		slug: row.slug,
	};
}

async function runWorktreeAdd({
	baseBranch,
	branchName,
	localCommandService,
	repositoryPath,
	workspacePath,
}: {
	baseBranch: string;
	branchName: string;
	localCommandService: LocalCommandService;
	repositoryPath: string;
	workspacePath: string;
}): Promise<UnarchiveWorkspaceDiagnostic | null> {
	const outcome = await runWorktreeAddShared({
		baseBranch,
		branchName,
		localCommandService,
		repositoryPath,
		workspacePath,
	});

	if (outcome.status === 'success') {
		return null;
	}

	const message =
		outcome.status === 'git-missing'
			? outcome.message
			: outcome.message || `git worktree add failed for branch ${branchName}.`;

	return {
		code: 'worktree-recreate-failed',
		message,
		path: workspacePath,
		severity: 'error',
	};
}

function restoreContextDirectory({
	diagnostics,
	source,
}: {
	diagnostics: UnarchiveWorkspaceDiagnostic[];
	source: ArchivedWorkspace;
}): boolean {
	if (!source.archivedContextPath) {
		diagnostics.push({
			code: 'archived-context-missing',
			message:
				'No archived context path was recorded; skipped .context/ restore.',
			severity: 'warning',
		});
		return false;
	}

	const preservedContextDir = path.join(
		source.archivedContextPath,
		CONTEXT_DIRECTORY,
	);
	if (!existsSync(preservedContextDir)) {
		diagnostics.push({
			code: 'archived-context-missing',
			message: `No .context/ directory found under ${source.archivedContextPath}; skipped restore.`,
			path: source.archivedContextPath,
			severity: 'warning',
		});
		return false;
	}

	const targetContextDir = path.join(source.path, CONTEXT_DIRECTORY);
	try {
		mkdirSync(source.path, { recursive: true });
		cpSync(preservedContextDir, targetContextDir, {
			dereference: false,
			errorOnExist: false,
			force: true,
			preserveTimestamps: true,
			recursive: true,
			verbatimSymlinks: true,
		});
		return true;
	} catch (error) {
		diagnostics.push({
			code: 'archived-context-restore-failed',
			message:
				error instanceof Error
					? error.message
					: 'Failed to restore the .context/ directory.',
			path: targetContextDir,
			severity: 'warning',
		});
		return false;
	}
}

function clearArchivedAt({
	database,
	unarchivedAt,
	workspaceId,
}: {
	database: DatabaseSync;
	unarchivedAt: string;
	workspaceId: string;
}): void {
	withTransaction(database, () => {
		clearWorkspaceArchived({ database, id: workspaceId, unarchivedAt });
	});
}

function failure(
	diagnostic: UnarchiveWorkspaceDiagnostic,
): UnarchiveWorkspaceResult {
	return failureResult(diagnostic, {
		workspace: null,
	});
}

interface WorkspaceRow {
	archiveRecordId: string | null;
	archivedAt: string | null;
	archivedContextPath: string | null;
	baseBranch: string | null;
	branchCleanupRaw: number | null;
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

function isWorkspaceRow(row: unknown): row is WorkspaceRow {
	if (!isRecord(row)) {
		return false;
	}
	return (
		hasWorkspaceRepositoryIdentity(row) &&
		isNullableString(row.archiveRecordId) &&
		isNullableString(row.archivedContextPath) &&
		isNullableString(row.baseBranch) &&
		isNullableNumber(row.branchCleanupRaw)
	);
}

export type { UnarchiveWorkspaceDiagnosticCode };
