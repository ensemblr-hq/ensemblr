import type { DatabaseSync } from 'node:sqlite';

import {
	type CheckpointRow,
	getCheckpointByTurnId,
	getNextCheckpointInPiSession,
	insertCheckpoint,
	listCheckpointsForPiSession,
} from '../storage/repositories/index.ts';
import {
	getPiSessionBranchById,
	getTurnById,
	setBranchMetadata,
} from '../storage/repositories/pi-session-repository.ts';
import {
	captureWorkspaceCheckpoint,
	diffTrees,
	type GitDiffResult,
	restoreWorkspaceTo,
	snapshotWorkingTree,
} from './git-checkpoint.ts';

/**
 * Capture port injected into the Pi session lifecycle. Runs before each user
 * prompt reaches the runtime.
 *
 * Safety policy (ADR 0012): capture failure WARNS and continues — the prompt
 * is not blocked. The turn simply has no checkpoint row, which the restore /
 * turn-diff UI must treat as "no snapshot available". Rationale: blocking all
 * prompting on a degraded git state (or a non-git scratch workspace) is worse
 * than losing one turn's snapshot, and the failure is logged loudly.
 */
interface CheckpointCaptureInput {
	cwd: string;
	database: DatabaseSync;
	label: string;
	piSessionId: string;
	turnId: string;
	workspaceId: string;
}

/**
 * Function signature for the checkpoint capture port, invoked before a prompt
 * reaches the runtime; resolves to the recorded checkpoint row, or null when
 * capture was skipped or failed.
 */
export type CheckpointCapturePort = (
	input: CheckpointCaptureInput,
) => Promise<CheckpointRow | null>;

/** Builds the private ref name for a workspace/turn pair (ADR 0012). */
export function checkpointRefFor({
	turnId,
	workspaceId,
}: {
	turnId: string;
	workspaceId: string;
}): string {
	return `refs/ensemblr/checkpoints/${sanitizeRefSegment(workspaceId)}/${sanitizeRefSegment(turnId)}`;
}

/** Creates the production capture port (git + SQLite). */
export function createCheckpointCapture(): CheckpointCapturePort {
	return async ({ cwd, database, label, piSessionId, turnId, workspaceId }) => {
		const ref = checkpointRefFor({ turnId, workspaceId });
		try {
			const captured = await captureWorkspaceCheckpoint({
				cwd,
				message: `ensemblr checkpoint: ${label}`,
				ref,
			});
			return insertCheckpoint({
				database,
				input: {
					gitHash: captured.commitHash,
					gitRef: captured.ref,
					label,
					metadata: { treeHash: captured.treeHash },
					piSessionId,
					turnId,
					workspaceId,
				},
			});
		} catch (error) {
			console.warn('[checkpoints] capture failed; prompt continues', {
				cwd,
				error: error instanceof Error ? error.message : String(error),
				ref,
				turnId,
				workspaceId,
			});
			return null;
		}
	};
}

/** Keeps ids inside the ref namespace even if a slug-like id sneaks in. */
function sanitizeRefSegment(segment: string): string {
	return segment.replaceAll(/[^\w.-]/g, '-');
}

export class CheckpointServiceError extends Error {
	readonly code: 'no-checkpoint' | 'workspace-missing';

	constructor({
		code,
		message,
	}: {
		code: 'no-checkpoint' | 'workspace-missing';
		message: string;
	}) {
		super(message);
		this.name = 'CheckpointServiceError';
		this.code = code;
	}
}

/** Lists checkpoints captured for a Pi session, oldest first. */
export function listTurnCheckpoints({
	database,
	piSessionId,
}: {
	database: DatabaseSync;
	piSessionId: string;
}): readonly CheckpointRow[] {
	return listCheckpointsForPiSession({ database, piSessionId });
}

/** A turn's git diff paired with the checkpoint it was computed against. */
interface TurnDiffResult extends GitDiffResult {
	checkpoint: CheckpointRow;
}

/**
 * Diff between a turn's pre-prompt checkpoint and the post-turn state: the
 * next checkpoint in the same session when one exists, otherwise the live
 * working tree (tracked + untracked).
 */
export async function computeTurnDiff({
	cwd,
	database,
	turnId,
}: {
	cwd: string;
	database: DatabaseSync;
	turnId: string;
}): Promise<TurnDiffResult> {
	const checkpoint = requireCheckpointForTurn({ database, turnId });
	const next = findNextCheckpoint({ checkpoint, database });
	const toRev = next?.gitHash ?? (await snapshotWorkingTree(cwd));
	const diff = await diffTrees({
		cwd,
		fromRev: checkpoint.gitHash ?? checkpoint.gitRef,
		toRev,
	});
	return { ...diff, checkpoint };
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
 * Find the checkpoint captured after the given one in the same Pi session.
 * @returns The next checkpoint, or null when it is the latest or unlinked
 */
function findNextCheckpoint({
	checkpoint,
	database,
}: {
	checkpoint: CheckpointRow;
	database: DatabaseSync;
}): CheckpointRow | null {
	if (!checkpoint.piSessionId) {
		return null;
	}
	return getNextCheckpointInPiSession({
		checkpointId: checkpoint.id,
		database,
		piSessionId: checkpoint.piSessionId,
	});
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
				(SELECT MIN(ordinal) FROM pi_session_events WHERE turn_id = ?) AS turn_min,
				(SELECT MAX(ordinal) FROM pi_session_events WHERE branch_id = ?) AS branch_max`,
		)
		.get(turnId, turn.branchId) as {
		branch_max: number | null;
		turn_min: number | null;
	};
	if (bounds.turn_min === null || bounds.branch_max === null) {
		return;
	}

	const branch = getPiSessionBranchById({ database, id: turn.branchId });
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
