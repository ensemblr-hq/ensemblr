import { existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

import type {
	ReclaimArchivedWorkspaceDiskDiagnostic,
	ReclaimArchivedWorkspaceDiskEntry,
	ReclaimArchivedWorkspaceDiskRequest,
	ReclaimArchivedWorkspaceDiskResult,
} from '../../shared/ipc/contracts/workspace';
import type { LocalCommandService } from '../commands/local-command';
import type { EnsemblrDatabaseService } from '../storage';
import { updateArchiveRecordPruneState } from '../storage/repositories/archive-record-repository.ts';
import { selectArchivedWorkspaceJoinById } from '../storage/repositories/workspace-repository.ts';
import { pruneWorktree } from './prune-worktree.ts';
import {
	hasWorkspaceRepositoryIdentity,
	isNullableNumber,
	isNullableString,
	isRecord,
} from './row-guards.ts';

/** Public surface of the retroactive disk-reclaim service. */
export interface ReclaimArchivedWorkspaceDiskService {
	reclaim: (
		request: ReclaimArchivedWorkspaceDiskRequest,
	) => Promise<ReclaimArchivedWorkspaceDiskResult>;
}

/** Options for {@link createReclaimArchivedWorkspaceDiskService}. */
export interface CreateReclaimArchivedWorkspaceDiskServiceOptions {
	databaseService: EnsemblrDatabaseService;
	localCommandService: LocalCommandService;
}

/** Archived workspace fields a reclaim needs in one read. */
interface ArchivedWorkspace {
	archiveRecordId: string | null;
	archivedAt: string | null;
	archivedContextPath: string | null;
	branchName: string | null;
	id: string;
	name: string;
	path: string;
	repositoryPath: string;
	worktreePruned: boolean;
}

/**
 * Builds the service that reclaims the disk archived workspaces still occupy.
 *
 * Archiving used to always leave the worktree on disk, so a user who has been
 * archiving for months is holding tens of gigabytes of dependencies and build
 * output for workspaces they finished with. This is the retroactive
 * counterpart of archiving with `reclaimDisk`: same prune, same guarantees,
 * applied to rows that were archived before the setting existed.
 *
 * Workspaces are processed one at a time — concurrent `git worktree remove`
 * runs in one repository contend on the worktree admin lock — and one failure
 * never stops the rest, so a bulk reclaim reports per-workspace outcomes.
 * @param options - Service dependencies.
 * @returns A {@link ReclaimArchivedWorkspaceDiskService}.
 */
export function createReclaimArchivedWorkspaceDiskService({
	databaseService,
	localCommandService,
}: CreateReclaimArchivedWorkspaceDiskServiceOptions): ReclaimArchivedWorkspaceDiskService {
	return {
		reclaim: async (request) => {
			const database = databaseService.getConnection()?.database;
			if (!database) {
				return requestFailure(request.workspaceIds, {
					code: 'database-unavailable',
					message: 'SQLite is unavailable; no disk was reclaimed.',
					severity: 'error',
				});
			}

			const workspaceIds = readWorkspaceIds(request);
			if (workspaceIds.length === 0) {
				return requestFailure(workspaceIds, {
					code: 'workspace-ids-required',
					message:
						'No workspace was named to reclaim, so nothing was removed from disk.',
					severity: 'error',
				});
			}

			const entries: ReclaimArchivedWorkspaceDiskEntry[] = [];
			let bytesFreed = 0;
			let reclaimedCount = 0;
			for (const workspaceId of workspaceIds) {
				// Sequential by necessity: two `git worktree remove` runs in the same
				// repository contend on the worktree admin lock and fail rather than
				// wait, and a bulk reclaim is dominated by unlink time regardless.
				// oxlint-disable-next-line react-doctor/async-await-in-loop
				const entry = await reclaimOneSafely({
					database,
					localCommandService,
					workspaceId,
				});
				entries.push(entry);
				bytesFreed += entry.bytesFreed ?? 0;
				if (entry.status === 'reclaimed') {
					reclaimedCount += 1;
				}
			}

			return { bytesFreed, diagnostics: [], entries, reclaimedCount };
		},
	};
}

/**
 * Runs {@link reclaimOne} with a boundary around it, so one workspace's
 * unexpected throw becomes that workspace's failed entry rather than a rejected
 * IPC call that abandons every id still queued behind it.
 * @param options - Open database, git dependencies, and the workspace to reclaim.
 * @returns That workspace's entry in the reclaim result.
 */
async function reclaimOneSafely(options: {
	database: DatabaseSync;
	localCommandService: LocalCommandService;
	workspaceId: string;
}): Promise<ReclaimArchivedWorkspaceDiskEntry> {
	try {
		return await reclaimOne(options);
	} catch (error) {
		return entryFailure(options.workspaceId, {
			code: 'worktree-prune-failed',
			message:
				error instanceof Error
					? error.message
					: 'The worktree could not be removed.',
			severity: 'error',
		});
	}
}

/**
 * Reclaims one archived workspace's worktree, refusing anything that is not an
 * archived workspace with a record to stamp and a directory still on disk.
 * @param options - Open database, git dependencies, and the workspace to reclaim.
 * @returns That workspace's entry in the reclaim result.
 */
async function reclaimOne({
	database,
	localCommandService,
	workspaceId,
}: {
	database: DatabaseSync;
	localCommandService: LocalCommandService;
	workspaceId: string;
}): Promise<ReclaimArchivedWorkspaceDiskEntry> {
	const source = readArchivedWorkspace(database, workspaceId);
	if (!source) {
		return entryFailure(workspaceId, {
			code: 'workspace-not-found',
			message: `No workspace is registered with id ${workspaceId}.`,
			severity: 'error',
		});
	}

	if (!source.archivedAt) {
		return entryFailure(workspaceId, {
			code: 'workspace-not-archived',
			message: `Workspace "${source.name}" is not archived, so its worktree is still in use.`,
			severity: 'error',
		});
	}

	if (!source.archiveRecordId) {
		return entryFailure(workspaceId, {
			code: 'archive-record-missing',
			message: `Workspace "${source.name}" has no archive record, so a prune could not be recorded and would not be reversible.`,
			severity: 'error',
		});
	}

	if (source.worktreePruned || !existsSync(source.path)) {
		return {
			bytesFreed: null,
			diagnostics: [
				{
					code: 'worktree-already-pruned',
					message: `Workspace "${source.name}" has no worktree on disk; nothing to reclaim.`,
					path: source.path,
					severity: 'info',
				},
			],
			status: 'skipped',
			workspaceId,
		};
	}

	const pruned = await pruneWorktree({
		archivedContextPath: source.archivedContextPath,
		branchName: source.branchName,
		localCommandService,
		repositoryPath: source.repositoryPath,
		workspaceId: source.id,
		workspacePath: source.path,
	});

	if (pruned.status === 'failure') {
		return entryFailure(workspaceId, {
			code: 'worktree-prune-failed',
			message: pruned.message ?? 'The worktree could not be removed.',
			path: source.path,
			severity: 'error',
		});
	}

	// The directory is already gone by here, so this stamp cannot be allowed to
	// throw: it would abandon every id still queued behind this one and leave a
	// removed worktree behind a row claiming nothing was pruned. Unarchive
	// recovers that state from the branch, so the entry says what was lost —
	// the record, not the work.
	try {
		updateArchiveRecordPruneState({
			database,
			prunedHeadCommit: pruned.headCommit,
			prunedWipCommit: pruned.wipCommit,
			prunedWipRef: pruned.wipRef,
			recordId: source.archiveRecordId,
		});
	} catch (error) {
		return {
			bytesFreed: pruned.bytesFreed,
			diagnostics: [
				{
					code: 'workspace-update-failed',
					message:
						`The worktree for "${source.name}" was removed but the prune could not be recorded. Its branch and snapshot are intact, so unarchiving still restores it. ${error instanceof Error ? error.message : ''}`.trim(),
					path: source.path,
					severity: 'error',
				},
			],
			status: 'failure',
			workspaceId,
		};
	}

	return {
		bytesFreed: pruned.bytesFreed,
		diagnostics: [],
		status: 'reclaimed',
		workspaceId,
	};
}

/** Trims and de-duplicates the requested ids, dropping empty ones. */
function readWorkspaceIds(
	request: ReclaimArchivedWorkspaceDiskRequest,
): string[] {
	if (!Array.isArray(request.workspaceIds)) {
		return [];
	}
	const ids = new Set<string>();
	for (const candidate of request.workspaceIds) {
		const id = typeof candidate === 'string' ? candidate.trim() : '';
		if (id.length > 0) {
			ids.add(id);
		}
	}
	return [...ids];
}

/**
 * Reads an archived workspace joined with its repository and latest archive
 * record.
 * @param database - Open SQLite connection.
 * @param workspaceId - Workspace to read.
 * @returns The archived workspace, or null when missing or malformed.
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
		archiveRecordId: row.archiveRecordId,
		archivedAt: row.archivedAt,
		archivedContextPath: row.archivedContextPath,
		branchName: row.branchName,
		id: row.id,
		name: row.name,
		path: row.path,
		repositoryPath: row.repositoryPath,
		worktreePruned: row.worktreePrunedRaw === 1,
	};
}

/** Raw joined row read before a reclaim. */
interface WorkspaceRow {
	archiveRecordId: string | null;
	archivedAt: string | null;
	archivedContextPath: string | null;
	branchName: string | null;
	id: string;
	name: string;
	path: string;
	repositoryPath: string;
	worktreePrunedRaw: number | null;
}

/**
 * Narrows an unknown SQLite row to a {@link WorkspaceRow}.
 * @param row - Candidate row returned by the join query.
 * @returns True when the row carries the fields a reclaim needs.
 */
function isWorkspaceRow(row: unknown): row is WorkspaceRow {
	if (!isRecord(row)) {
		return false;
	}
	return (
		hasWorkspaceRepositoryIdentity(row) &&
		isNullableString(row.archiveRecordId) &&
		isNullableString(row.archivedContextPath) &&
		isNullableNumber(row.worktreePrunedRaw)
	);
}

/** Wraps one diagnostic as a failed entry for a single workspace. */
function entryFailure(
	workspaceId: string,
	diagnostic: ReclaimArchivedWorkspaceDiskDiagnostic,
): ReclaimArchivedWorkspaceDiskEntry {
	return {
		bytesFreed: null,
		diagnostics: [diagnostic],
		status: 'failure',
		workspaceId,
	};
}

/**
 * Reports a failure of the request itself, both at the top level and against
 * every id it named.
 *
 * The top-level copy is what makes an empty or unparseable request visible:
 * with no ids there are no entries to carry a diagnostic, and a result that is
 * empty everywhere reads to the caller as "there was nothing to reclaim".
 * @param workspaceIds - Ids the request named, if any.
 * @param diagnostic - The problem that stopped the whole request.
 * @returns A result reclaiming nothing and naming why.
 */
function requestFailure(
	workspaceIds: readonly string[] | undefined,
	diagnostic: ReclaimArchivedWorkspaceDiskDiagnostic,
): ReclaimArchivedWorkspaceDiskResult {
	const ids = Array.isArray(workspaceIds) ? workspaceIds : [];
	return {
		bytesFreed: 0,
		diagnostics: [diagnostic],
		entries: ids.map((workspaceId) => entryFailure(workspaceId, diagnostic)),
		reclaimedCount: 0,
	};
}
