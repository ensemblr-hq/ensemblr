import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
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
import type { EnsemblrDatabaseService } from '../storage';
import { clearArchiveRecordPruneState } from '../storage/repositories/archive-record-repository.ts';
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
import { toLifecycleTargets } from './archive-lifecycle-targets.ts';
import { copyDirectoryTree } from './copy-directory.ts';
import {
	refResolvesToCommit,
	runRefDelete,
	runWorktreeAdd as runWorktreeAddShared,
} from './git-ops.ts';
import { archivedWorktreeRefFor } from './prune-worktree.ts';
import {
	invalidateSetupMarker,
	rehydrateWorktree,
} from './rehydrate-worktree.ts';
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
	databaseService: EnsemblrDatabaseService;
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
	prunedHeadCommit: string | null;
	prunedWipCommit: string | null;
	repositoryId: string;
	repositoryName: string;
	repositoryPath: string;
	repositorySlug: string;
	slug: string;
	worktreePruned: boolean;
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
					...toLifecycleTargets(source),
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

			const materialized = await materializeWorktree({
				diagnostics,
				localCommandService,
				source,
			});
			if ('diagnostic' in materialized) {
				return {
					diagnostics: [...diagnostics, materialized.diagnostic],
					status: 'failure',
					workspace: null,
				};
			}
			const { branchRecreated, rehydrated } = materialized;

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

			const contextRestored = await restoreContextDirectory({
				diagnostics,
				source,
			});

			if (rehydrated) {
				// The restored `.context/` carries the setup marker from before the
				// prune, but the dependencies it vouches for are gone with the
				// directory. Clearing it is what makes the next open rebuild them.
				invalidateSetupMarker(source.path);
				// The snapshot is back in the worktree, so the ref that pinned it has
				// nothing left to protect — and it outlives the branch by design, so
				// leaving it here would keep the commits reachable forever, in the
				// user's own repository, past every delete that could clean it up.
				await runRefDelete({
					localCommandService,
					ref: archivedWorktreeRefFor(source.id),
					repositoryPath: source.repositoryPath,
				});
				if (source.archiveRecordId) {
					clearPruneState({
						database,
						recordId: source.archiveRecordId,
						diagnostics,
					});
				}
			}

			const postHookOutcome = await archiveLifecycleService.invoke(
				'post-unarchive-workspace',
				{
					archivedAt,
					archivedContextPath: source.archivedContextPath,
					branchCleanup: source.branchCleanup,
					...toLifecycleTargets(source),
				},
			);
			pushLifecycleDiagnostics(diagnostics, postHookOutcome.diagnostics);

			const workspace: UnarchivedWorkspaceSnapshot = {
				branchName: source.branchName,
				branchRecreated,
				contextRestored,
				id: source.id,
				rehydrated,
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

/**
 * Load an archived workspace joined with its repository and archive record.
 * @param database - Open SQLite connection
 * @param workspaceId - ID of the archived workspace to load
 * @returns The archived workspace, or null when it is missing or malformed
 */
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
		prunedHeadCommit: row.prunedHeadCommit,
		prunedWipCommit: row.prunedWipCommit,
		repositoryId: row.repositoryId,
		repositoryName: row.repositoryName,
		repositoryPath: row.repositoryPath,
		repositorySlug: row.repositorySlug,
		slug: row.slug,
		worktreePruned: row.worktreePrunedRaw === 1,
	};
}

/** How the worktree came back, or the diagnostic that stopped it. */
type MaterializeOutcome =
	| { branchRecreated: boolean; rehydrated: boolean }
	| { diagnostic: UnarchiveWorkspaceDiagnostic };

/**
 * Puts the workspace's worktree back, by whichever route its archive left open.
 *
 * A pruned archive kept its branch and a snapshot of the working tree, so it is
 * re-derived from git and comes back byte for byte. An archive that deleted the
 * branch has nothing left to check out, so it is recreated from the recorded
 * base branch and its commits do not come with it. Anything else should still
 * be on disk — and when it is not, the branch is tried before the row is
 * written off, because a directory can go missing without the workspace being
 * unrecoverable.
 * @param options - Diagnostics sink, git dependencies, and the archived workspace.
 * @returns How the worktree was materialized, or the diagnostic that blocked it.
 */
async function materializeWorktree({
	diagnostics,
	localCommandService,
	source,
}: {
	diagnostics: UnarchiveWorkspaceDiagnostic[];
	localCommandService: LocalCommandService;
	source: ArchivedWorkspace;
}): Promise<MaterializeOutcome> {
	if (source.worktreePruned) {
		return await rehydratePrunedWorktree({
			diagnostics,
			localCommandService,
			source,
		});
	}

	if (source.branchCleanup) {
		return await recreateDiscardedWorktree({ localCommandService, source });
	}

	if (!existsSync(source.path)) {
		return await recoverMissingWorktree({
			diagnostics,
			localCommandService,
			source,
		});
	}

	return { branchRecreated: false, rehydrated: false };
}

/**
 * Last resort for an archive that says nothing was pruned yet has no directory:
 * check the branch out again rather than write the row off.
 *
 * Two things land here. A prune whose record never got stamped — the removal
 * succeeded and the SQLite write did not — and a worktree the user deleted by
 * hand. Both leave the branch, and often the prune's private ref, perfectly
 * intact, so telling the user to purge the archive would destroy a workspace
 * git could have handed straight back.
 *
 * The snapshot ref is derived from the workspace id rather than read from the
 * record, which is exactly the column that is missing in the first case; when
 * no such ref exists the restore fails harmlessly and the branch checkout still
 * stands.
 * @param options - Diagnostics sink, git dependencies, and the archived workspace.
 * @returns How the worktree was materialized, or the diagnostic that blocked it.
 */
async function recoverMissingWorktree({
	diagnostics,
	localCommandService,
	source,
}: {
	diagnostics: UnarchiveWorkspaceDiagnostic[];
	localCommandService: LocalCommandService;
	source: ArchivedWorkspace;
}): Promise<MaterializeOutcome> {
	const orphaned: MaterializeOutcome = {
		diagnostic: {
			code: 'worktree-recreate-failed',
			message: `Worktree path is missing on disk: ${source.path}. Run delete-from-archive to clean up the orphaned record.`,
			path: source.path,
			severity: 'error',
		},
	};

	if (!source.branchName) {
		return orphaned;
	}

	const branchExists = await refResolvesToCommit({
		localCommandService,
		ref: `refs/heads/${source.branchName}`,
		repositoryPath: source.repositoryPath,
	});
	if (!branchExists) {
		return orphaned;
	}

	const outcome = await rehydrateWorktree({
		archivedContextPath: source.archivedContextPath,
		branchName: source.branchName,
		localCommandService,
		prunedHeadCommit: null,
		prunedWipCommit: archivedWorktreeRefFor(source.id),
		repositoryPath: source.repositoryPath,
		workspacePath: source.path,
	});
	if (outcome.status === 'failure') {
		return orphaned;
	}

	diagnostics.push({
		code: 'worktree-recreate-failed',
		message: `The worktree folder was missing, so it was checked out again from branch "${source.branchName}". Dependencies and build output are rebuilt by the setup script.`,
		path: source.path,
		severity: 'warning',
	});

	return { branchRecreated: false, rehydrated: true };
}

/**
 * Re-derives a pruned workspace: checks its branch out at the original path and
 * restores the snapshotted working tree on top.
 * @param options - Diagnostics sink, git dependencies, and the archived workspace.
 * @returns How the worktree was materialized, or the diagnostic that blocked it.
 */
async function rehydratePrunedWorktree({
	diagnostics,
	localCommandService,
	source,
}: {
	diagnostics: UnarchiveWorkspaceDiagnostic[];
	localCommandService: LocalCommandService;
	source: ArchivedWorkspace;
}): Promise<MaterializeOutcome> {
	if (!source.branchName) {
		return {
			diagnostic: {
				code: 'pruned-branch-missing',
				message:
					'The pruned workspace recorded no branch, so its worktree cannot be re-derived.',
				severity: 'error',
			},
		};
	}

	const outcome = await rehydrateWorktree({
		archivedContextPath: source.archivedContextPath,
		branchName: source.branchName,
		localCommandService,
		prunedHeadCommit: source.prunedHeadCommit,
		prunedWipCommit: source.prunedWipCommit,
		repositoryPath: source.repositoryPath,
		workspacePath: source.path,
	});

	if (outcome.status === 'failure') {
		return {
			diagnostic: {
				code:
					outcome.reason === 'worktree-add-failed'
						? 'worktree-recreate-failed'
						: outcome.reason === 'branch-missing'
							? 'pruned-branch-missing'
							: 'pruned-snapshot-missing',
				message: outcome.message,
				path: source.path,
				severity: 'error',
			},
		};
	}

	if (source.prunedWipCommit && !outcome.workingTreeRestored) {
		diagnostics.push({
			code: 'pruned-snapshot-restore-failed',
			message: `The branch was checked out, but the uncommitted changes captured at ${source.prunedWipCommit} could not be restored.`,
			path: source.path,
			severity: 'warning',
		});
	}

	return { branchRecreated: outcome.branchRecreated, rehydrated: true };
}

/**
 * Recreates the worktree of an archive that deleted its branch, cutting a fresh
 * branch from the recorded base. The original commits are gone by design — this
 * is the reverse of a discard, not of a prune.
 * @param options - Git dependencies and the archived workspace.
 * @returns How the worktree was materialized, or the diagnostic that blocked it.
 */
async function recreateDiscardedWorktree({
	localCommandService,
	source,
}: {
	localCommandService: LocalCommandService;
	source: ArchivedWorkspace;
}): Promise<MaterializeOutcome> {
	if (!source.archiveRecordId) {
		return {
			diagnostic: {
				code: 'archive-record-missing',
				message:
					'No archive record was found for this workspace; the original worktree path cannot be recreated.',
				severity: 'error',
			},
		};
	}
	if (!source.branchName) {
		return {
			diagnostic: {
				code: 'base-branch-missing',
				message:
					'The archived branch name was not preserved; the worktree cannot be recreated.',
				severity: 'error',
			},
		};
	}
	if (!source.baseBranch) {
		return {
			diagnostic: {
				code: 'base-branch-missing',
				message:
					'The base branch was not preserved in the archive record; the worktree cannot be recreated.',
				severity: 'error',
			},
		};
	}

	const recreateDiagnostic = await runWorktreeAdd({
		baseBranch: source.baseBranch,
		branchName: source.branchName,
		localCommandService,
		repositoryPath: source.repositoryPath,
		workspacePath: source.path,
	});
	if (recreateDiagnostic) {
		return { diagnostic: recreateDiagnostic };
	}

	return { branchRecreated: true, rehydrated: false };
}

/**
 * Clears the archive row's prune columns now that the worktree is back on disk,
 * so re-archiving does not read stale snapshot state. A failure only costs a
 * misleading badge in the archive browser, so it degrades to a warning.
 * @param options - Open database, archive record id, and the diagnostics sink.
 */
function clearPruneState({
	database,
	diagnostics,
	recordId,
}: {
	database: DatabaseSync;
	diagnostics: UnarchiveWorkspaceDiagnostic[];
	recordId: string;
}): void {
	try {
		clearArchiveRecordPruneState({ database, recordId });
	} catch (error) {
		diagnostics.push({
			code: 'workspace-update-failed',
			message:
				error instanceof Error
					? error.message
					: 'Failed to clear the recorded prune state.',
			severity: 'warning',
		});
	}
}

/**
 * Recreate the workspace's git worktree from its base branch during unarchive.
 * @param options - Command service, repository and workspace paths, and branch names
 * @returns A diagnostic when the worktree could not be recreated, otherwise null
 */
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
		branchName,
		localCommandService,
		placement: { forkRef: baseBranch, kind: 'create' },
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

/**
 * Restore the workspace's preserved `.context/` directory from its archive snapshot.
 * @param options - Diagnostics sink and the archived workspace to restore from
 * @returns True when the directory was restored, false when skipped or on failure
 */
async function restoreContextDirectory({
	diagnostics,
	source,
}: {
	diagnostics: UnarchiveWorkspaceDiagnostic[];
	source: ArchivedWorkspace;
}): Promise<boolean> {
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
		await mkdir(source.path, { recursive: true });
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

	const restored = await copyDirectoryTree(
		preservedContextDir,
		targetContextDir,
	);

	if (restored.error !== null) {
		diagnostics.push({
			code: 'archived-context-restore-failed',
			message: restored.error,
			path: targetContextDir,
			severity: 'warning',
		});
		return false;
	}

	return true;
}

/**
 * Clear a workspace's archived marker within a transaction to mark it active again.
 * @param options - Open database, the unarchive timestamp, and the workspace id
 */
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

/**
 * Wrap a single diagnostic into a failed unarchive-workspace result.
 * @param diagnostic - The diagnostic explaining why the unarchive failed
 * @returns A failure result carrying the diagnostic
 */
function failure(
	diagnostic: UnarchiveWorkspaceDiagnostic,
): UnarchiveWorkspaceResult {
	return failureResult(diagnostic, {
		workspace: null,
	});
}

/** Raw joined workspace, repository, and archive-record row read during unarchive. */
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
	prunedHeadCommit: string | null;
	prunedWipCommit: string | null;
	repositoryId: string;
	repositoryName: string;
	repositoryPath: string;
	repositorySlug: string;
	slug: string;
	worktreePrunedRaw: number | null;
}

/**
 * Narrow an unknown SQLite row to a {@link WorkspaceRow}.
 * @param row - Candidate row returned by the join query
 * @returns True when the row has the required workspace and archive fields
 */
function isWorkspaceRow(row: unknown): row is WorkspaceRow {
	if (!isRecord(row)) {
		return false;
	}
	return (
		hasWorkspaceRepositoryIdentity(row) &&
		isNullableString(row.archiveRecordId) &&
		isNullableString(row.archivedContextPath) &&
		isNullableString(row.baseBranch) &&
		isNullableString(row.prunedHeadCommit) &&
		isNullableString(row.prunedWipCommit) &&
		isNullableNumber(row.branchCleanupRaw) &&
		isNullableNumber(row.worktreePrunedRaw)
	);
}

export type { UnarchiveWorkspaceDiagnosticCode };
