import type { DatabaseSync } from 'node:sqlite';
import {
	resolveTurnDiffEnds,
	type TurnDiffEnd,
} from '../../shared/turn-diff-range.ts';
import {
	getAgentSessionBranchById,
	getTurnById,
	listAgentSessionsByWorkspace,
	setBranchMetadata,
} from '../storage/repositories/agent-session-repository.ts';
import {
	type CheckpointRow,
	getCheckpointByTurnId,
	listTurnCheckpointsForWorkspace,
	type TurnCheckpointRow,
} from '../storage/repositories/index.ts';
import {
	diffTrees,
	type GitDiffResult,
	restoreWorkspaceTo,
	snapshotWorkingTree,
} from './git-checkpoint.ts';

/** Why a checkpoint service operation failed, as the IPC layer reports it. */
type CheckpointServiceErrorCode =
	| 'no-checkpoint'
	| 'range-unknown'
	| 'workspace-missing';

/** Typed error thrown by checkpoint service operations for IPC translation. */
export class CheckpointServiceError extends Error {
	readonly code: CheckpointServiceErrorCode;

	constructor({
		code,
		message,
	}: {
		code: CheckpointServiceErrorCode;
		message: string;
	}) {
		super(message);
		this.name = 'CheckpointServiceError';
		this.code = code;
	}
}

/** A captured checkpoint paired with where the turn it opened ends. */
interface TurnCheckpoint {
	checkpoint: CheckpointRow;
	end: TurnDiffEnd;
}

/**
 * Lists every turn checkpoint in a workspace, oldest capture first, each with
 * the end of the turn it opened. One workspace-wide read serves both the chat
 * timelines and the Changes panel, because a chat's newest turn is bounded by
 * whatever any other chat in the workspace captured after it.
 */
export function listWorkspaceCheckpoints({
	database,
	isRuntimeOpen = everySessionLive,
	workspaceId,
}: {
	database: DatabaseSync;
	/** Whether a session's runtime is up now; defaults to trusting its row. */
	isRuntimeOpen?: (agentSessionId: string) => boolean;
	workspaceId: string;
}): readonly TurnCheckpoint[] {
	const turns = listTurnCheckpointsForWorkspace({ database, workspaceId });
	const ends = resolveWorkspaceTurnEnds({
		database,
		isRuntimeOpen,
		turns,
		workspaceId,
	});
	return turns
		.flatMap(({ checkpoint, turnId }) =>
			checkpoint
				? [{ checkpoint, end: ends.get(turnId) ?? { kind: 'unknown' } }]
				: [],
		)
		.sort((left, right) =>
			compareCaptureOrder(left.checkpoint, right.checkpoint),
		);
}

/** A turn's git diff paired with the checkpoint it was computed against. */
interface TurnDiffResult extends GitDiffResult {
	checkpoint: CheckpointRow;
}

/**
 * Diff between a turn's pre-prompt checkpoint and the end
 * {@link resolveTurnDiffEnds} gives it: a later checkpoint, or — for a turn
 * still running as its session's newest — the live working tree (tracked +
 * untracked).
 */
export async function computeTurnDiff({
	cwd,
	database,
	isRuntimeOpen = everySessionLive,
	turnId,
}: {
	cwd: string;
	database: DatabaseSync;
	/** Whether a session's runtime is up now; defaults to trusting its row. */
	isRuntimeOpen?: (agentSessionId: string) => boolean;
	turnId: string;
}): Promise<TurnDiffResult> {
	const checkpoint = requireCheckpointForTurn({ database, turnId });
	if (!checkpoint.gitHash) {
		throw new CheckpointServiceError({
			code: 'no-checkpoint',
			message: `Checkpoint for turn ${turnId} has no recorded commit.`,
		});
	}
	const end = resolveWorkspaceTurnEnds({
		database,
		isRuntimeOpen,
		turns: listTurnCheckpointsForWorkspace({
			database,
			workspaceId: checkpoint.workspaceId,
		}),
		workspaceId: checkpoint.workspaceId,
	}).get(turnId);
	if (!end || end.kind === 'unknown') {
		throw new CheckpointServiceError({
			code: 'range-unknown',
			message: `Where turn ${turnId} ended was not recorded, so its range is withheld.`,
		});
	}
	const toRev =
		end.kind === 'checkpoint' ? end.gitHash : await snapshotWorkingTree(cwd);
	const diff = await diffTrees({ cwd, fromRev: checkpoint.gitHash, toRev });
	return { ...diff, checkpoint };
}

/**
 * Resolves where every captured turn in a workspace ends. A session counts as
 * running only when its row says so and its runtime is actually up: a row a
 * crash left reading `streaming` describes a runtime that is gone, and trusting
 * it would read that session's last turn live forever.
 * @param database - Open database connection
 * @param isRuntimeOpen - Whether a session's runtime is up now
 * @param turns - The workspace's turns with their checkpoints
 * @param workspaceId - Workspace the turns belong to
 * @returns Each captured turn's end, keyed by turn id
 */
function resolveWorkspaceTurnEnds({
	database,
	isRuntimeOpen,
	turns,
	workspaceId,
}: {
	database: DatabaseSync;
	isRuntimeOpen: (agentSessionId: string) => boolean;
	turns: readonly TurnCheckpointRow[];
	workspaceId: string;
}): ReadonlyMap<string, TurnDiffEnd> {
	const live = listAgentSessionsByWorkspace({ database, workspaceId }).filter(
		(session) =>
			!CLOSED_SESSION_STATUSES.has(session.status) && isRuntimeOpen(session.id),
	);
	return resolveTurnDiffEnds({
		busySessionIds: new Set(
			live
				.filter((session) => session.status === 'streaming')
				.map((session) => session.id),
		),
		now: Date.now(),
		openSessionIds: new Set(live.map((session) => session.id)),
		turns: turns.map(
			({ agentSessionId, checkpoint, settled, settledAt, turnId }) => ({
				agentSessionId,
				checkpointCreatedAt: checkpoint?.createdAt ?? null,
				checkpointHash: checkpoint?.gitHash ?? null,
				checkpointId: checkpoint?.id ?? null,
				endFailed: Boolean(checkpoint?.endedAt && !checkpoint.endGitHash),
				endHash: checkpoint?.endGitHash ?? null,
				recordsEnd: checkpoint?.metadata.recordsEnd === true,
				settled,
				settledAt,
				turnId,
			}),
		),
	});
}

/** Session statuses whose runtime is gone, taking any end still owed with it. */
const CLOSED_SESSION_STATUSES: ReadonlySet<string> = new Set([
	'closed',
	'errored',
]);

/**
 * Default runtime check for callers that hold no live-session view: trusts the
 * session row alone.
 * @returns Always true
 */
function everySessionLive(): boolean {
	return true;
}

/**
 * Orders checkpoints the way they were captured, matching SQLite's
 * `ORDER BY created_at, id`.
 * @param left - First checkpoint
 * @param right - Second checkpoint
 * @returns Negative, zero, or positive, as `Array.prototype.sort` expects
 */
function compareCaptureOrder(
	left: CheckpointRow,
	right: CheckpointRow,
): number {
	if (left.createdAt !== right.createdAt) {
		return left.createdAt < right.createdAt ? -1 : 1;
	}
	if (left.id === right.id) {
		return 0;
	}
	return left.id < right.id ? -1 : 1;
}

/** Result of restoring a turn checkpoint, carrying the checkpoint restored. */
interface RestoreTurnCheckpointResult {
	checkpoint: CheckpointRow;
}

/**
 * Restores workspace files to a turn's pre-prompt checkpoint and hides the
 * Ensemblr-visible events from that turn onward (ADR 0012). Pi's own session
 * files are never touched; the hidden range is recorded on the branch metadata
 * so reloads keep the truncated view while newer (post-restore) events with
 * higher ordinals remain visible.
 */
export async function restoreTurnCheckpoint({
	cwd,
	database,
	turnId,
}: {
	cwd: string;
	database: DatabaseSync;
	turnId: string;
}): Promise<RestoreTurnCheckpointResult> {
	const checkpoint = requireCheckpointForTurn({ database, turnId });
	if (!checkpoint.gitHash) {
		throw new CheckpointServiceError({
			code: 'no-checkpoint',
			message: `Checkpoint for turn ${turnId} has no recorded commit.`,
		});
	}

	await restoreWorkspaceTo({ commitHash: checkpoint.gitHash, cwd });
	recordEventTruncation({ database, turnId });
	return { checkpoint };
}

/** Hidden ordinal range persisted on branch metadata after a restore. */
interface HiddenEventRange {
	/** Events with `ordinal > afterOrdinal` ... */
	afterOrdinal: number;
	/** ... and `ordinal <= throughOrdinal` are hidden. */
	throughOrdinal: number;
}

/** Reads the hidden ranges recorded on a branch's metadata. */
export function readHiddenEventRanges(
	metadata: Record<string, unknown>,
): readonly HiddenEventRange[] {
	const raw = metadata.hiddenEventRanges;
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw.flatMap((entry) => {
		if (
			entry &&
			typeof entry === 'object' &&
			typeof (entry as HiddenEventRange).afterOrdinal === 'number' &&
			typeof (entry as HiddenEventRange).throughOrdinal === 'number'
		) {
			return [entry as HiddenEventRange];
		}
		return [];
	});
}

/** True when an event ordinal falls inside any hidden range. */
export function isOrdinalHidden(
	ordinal: number,
	ranges: readonly HiddenEventRange[],
): boolean {
	return ranges.some(
		(range) => ordinal > range.afterOrdinal && ordinal <= range.throughOrdinal,
	);
}

/**
 * Look up the checkpoint captured for a turn, throwing when none exists.
 * @returns The turn's checkpoint row
 */
function requireCheckpointForTurn({
	database,
	turnId,
}: {
	database: DatabaseSync;
	turnId: string;
}): CheckpointRow {
	const checkpoint = getCheckpointByTurnId({ database, turnId });
	if (!checkpoint) {
		throw new CheckpointServiceError({
			code: 'no-checkpoint',
			message: `No checkpoint was captured for turn ${turnId}.`,
		});
	}
	return checkpoint;
}

/**
 * Appends the (turn-start, current-max] ordinal window to the branch's hidden
 * ranges so the timeline drops the restored-over turns without deleting rows.
 */
function recordEventTruncation({
	database,
	turnId,
}: {
	database: DatabaseSync;
	turnId: string;
}): void {
	const turn = getTurnById({ database, id: turnId });
	if (!turn) {
		console.warn(
			'[checkpoints] restore reverted files but turn is missing; timeline not truncated',
			{ turnId },
		);
		return;
	}
	const bounds = database
		.prepare(
			`SELECT
				(SELECT MIN(ordinal) FROM agent_session_events WHERE turn_id = ?) AS turn_min,
				(SELECT MAX(ordinal) FROM agent_session_events WHERE branch_id = ?) AS branch_max`,
		)
		.get(turnId, turn.branchId) as {
		branch_max: number | null;
		turn_min: number | null;
	};
	if (bounds.turn_min === null || bounds.branch_max === null) {
		return;
	}

	const branch = getAgentSessionBranchById({ database, id: turn.branchId });
	if (!branch) {
		console.warn(
			'[checkpoints] restore reverted files but branch is missing; timeline not truncated',
			{ branchId: turn.branchId, turnId },
		);
		return;
	}
	const ranges = [
		...readHiddenEventRanges(branch.metadata),
		{
			afterOrdinal: bounds.turn_min - 1,
			throughOrdinal: bounds.branch_max,
		} satisfies HiddenEventRange,
	];
	setBranchMetadata({
		database,
		id: turn.branchId,
		metadata: { ...branch.metadata, hiddenEventRanges: ranges },
	});
}
