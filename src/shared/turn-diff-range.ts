/**
 * Where one agent turn's changes end (ADR 0012). A turn opens at the checkpoint
 * captured as its input arrives and ends at the snapshot captured when it
 * stopped: the runtime settling, the user stopping it, or the next input — a
 * new prompt, a steer, or a follow-up — arriving. Once that end exists the
 * range is locked, and nothing that happens afterwards, by any agent or by
 * hand, is ever reported as the turn's.
 *
 * Main resolves every turn's end with {@link resolveTurnDiffEnds} and hands the
 * answer to the renderer, so the footer chips, the whole-turn diff, and a diff
 * tab opened from either all read one range rather than three reconstructions
 * of it.
 */

/** Where a turn's changes end. */
export type TurnDiffEnd =
	| {
			/** Commit the turn's changes stop at. */
			gitHash: string;
			kind: 'checkpoint';
	  }
	/**
	 * The turn's changes run to the live working tree: it is still running, or
	 * it has just stopped and the snapshot of its end is still being written.
	 */
	| { kind: 'working-tree' }
	/**
	 * Where the turn ended was lost — a capture failed, or the app went away
	 * before writing it. Diffing on to anything later would report other work as
	 * this turn's, so the range is withheld instead.
	 */
	| { kind: 'unknown' };

/**
 * How long after a turn settles its end snapshot is still treated as being
 * written. Longer than the three git steps a capture takes at their timeout,
 * so only an end that can no longer arrive — the app quit or crashed first —
 * outlives it.
 */
const PENDING_TURN_END_GRACE_MS = 5 * 60_000;

/** One agent turn as the resolver reads it. */
export interface TurnRangeInput {
	agentSessionId: string;
	/** When the turn's checkpoint row was written; orders checkpoints across sessions. */
	checkpointCreatedAt: string | null;
	/** Commit the turn's opening capture produced; null when it failed or has not landed. */
	checkpointHash: string | null;
	/** Id of the turn's checkpoint row, null until one is written. */
	checkpointId: string | null;
	/** Whether the turn's end was lost: its capture failed. */
	endFailed: boolean;
	/** Commit captured when the turn ended, or null while it runs. */
	endHash: string | null;
	/**
	 * Whether the turn's checkpoint was written by the code that records ends.
	 * Older rows never recorded one, so only they fall back to the next capture.
	 */
	recordsEnd: boolean;
	/** Whether the turn row says it ended — completed, aborted, or errored. */
	settled: boolean;
	/** When the turn row settled, or null while it is open. */
	settledAt: string | null;
	turnId: string;
}

/** A turn whose opening capture produced a commit. */
type CapturedTurn = TurnRangeInput & {
	checkpointCreatedAt: string;
	checkpointHash: string;
	checkpointId: string;
};

/**
 * Resolves where each captured turn's changes end.
 *
 * A turn with a recorded end is locked to it, and one whose end was lost is
 * `unknown`. Otherwise its end is still coming: a turn followed by another
 * stops at that turn's opening snapshot, and reads live while that snapshot is
 * being taken — nothing has touched the tree since, because the runtime does
 * not get the new input until it lands. A session's newest turn reads live
 * while its session runs it and, while its session is still open, while its
 * own end is written — a session that went away first took the end with it.
 * Rows from before ends were kept fall back to the next checkpoint any chat
 * took after them.
 * @param busySessionIds - Sessions with a turn in flight
 * @param now - Current time, in epoch milliseconds
 * @param openSessionIds - Sessions whose runtime is still up, busy or idle
 * @param turns - Every turn in the workspace, each session's in submission order
 * @returns Each captured turn's end, keyed by turn id
 */
export function resolveTurnDiffEnds({
	busySessionIds,
	now,
	openSessionIds,
	turns,
}: {
	busySessionIds: ReadonlySet<string>;
	now: number;
	openSessionIds: ReadonlySet<string>;
	turns: readonly TurnRangeInput[];
}): ReadonlyMap<string, TurnDiffEnd> {
	const captured = capturedInCaptureOrder(turns);
	const ends = new Map<string, TurnDiffEnd>();
	for (const session of groupBySession(turns).values()) {
		for (const [index, turn] of session.entries()) {
			if (!isCaptured(turn)) {
				continue;
			}
			ends.set(
				turn.turnId,
				resolveEnd({
					busy: busySessionIds.has(turn.agentSessionId),
					captured,
					endMayArrive:
						openSessionIds.has(turn.agentSessionId) && isRecent(turn, now),
					successor: session[index + 1] ?? null,
					turn,
				}),
			);
		}
	}
	return ends;
}

/**
 * Where one captured turn ends, by the rules {@link resolveTurnDiffEnds} lists.
 * @param busy - Whether the turn's session has a turn in flight
 * @param captured - Every captured turn in the workspace, in capture order
 * @param endMayArrive - Whether a settled turn's missing end can still land
 * @param successor - The next turn in the same session, or null for its newest
 * @param turn - The turn to resolve
 * @returns Where the turn's changes end
 */
function resolveEnd({
	busy,
	captured,
	endMayArrive,
	successor,
	turn,
}: {
	busy: boolean;
	captured: readonly CapturedTurn[];
	endMayArrive: boolean;
	successor: TurnRangeInput | null;
	turn: CapturedTurn;
}): TurnDiffEnd {
	if (turn.endHash) {
		return { gitHash: turn.endHash, kind: 'checkpoint' };
	}
	if (turn.endFailed) {
		return { kind: 'unknown' };
	}
	if (!turn.settled && turn.recordsEnd) {
		return runningEnd({ busy, successor });
	}
	if (successor) {
		return endAtSuccessor(successor, busy);
	}
	if (!turn.settled) {
		return busy
			? { kind: 'working-tree' }
			: nextCaptureInWorkspace(turn, captured);
	}
	return endMayArrive ? { kind: 'working-tree' } : { kind: 'unknown' };
}

/**
 * The end of a turn that never settled, written by code that settles every
 * turn the moment another input takes over from it. Such a turn is live only while
 * its session is running it, or while the next input's opening snapshot is
 * still being taken; anything else means the runtime went away mid-turn and
 * took the end with it — a later turn's snapshot would carry everything that
 * happened in between.
 * @param busy - Whether the session has a turn in flight
 * @param successor - The next turn in the same session, or null for its newest
 * @returns Where the turn's changes end
 */
function runningEnd({
	busy,
	successor,
}: {
	busy: boolean;
	successor: TurnRangeInput | null;
}): TurnDiffEnd {
	const opening = successor === null || successor.checkpointId === null;
	return busy && opening ? { kind: 'working-tree' } : { kind: 'unknown' };
}

/**
 * The end of a turn another turn followed, when the turn recorded none itself.
 * @param successor - The next turn in the same session
 * @param busy - Whether the session has a turn in flight
 * @returns The successor's opening snapshot; live while that snapshot is being
 *   taken; `unknown` when it failed, or never landed in a session now idle
 */
function endAtSuccessor(successor: TurnRangeInput, busy: boolean): TurnDiffEnd {
	if (successor.checkpointHash) {
		return { gitHash: successor.checkpointHash, kind: 'checkpoint' };
	}
	const opening = successor.checkpointId === null && busy;
	return opening ? { kind: 'working-tree' } : { kind: 'unknown' };
}

/**
 * Whether a turn settled recently enough for its end snapshot to still be on
 * its way.
 * @param turn - The turn to check
 * @param now - Current time, in epoch milliseconds
 * @returns True while the turn settled within {@link PENDING_TURN_END_GRACE_MS}
 */
function isRecent(turn: TurnRangeInput, now: number): boolean {
	const settledAt = turn.settledAt ? Date.parse(turn.settledAt) : Number.NaN;
	return (
		Number.isFinite(settledAt) && now - settledAt < PENDING_TURN_END_GRACE_MS
	);
}

/**
 * The first checkpoint any chat in the workspace captured after a turn's own —
 * the bound for a session's last turn from before turns recorded their end or
 * settled.
 * @param turn - The turn to bound
 * @param captured - Every captured turn in the workspace, in capture order
 * @returns That checkpoint, or `unknown` when none followed
 */
function nextCaptureInWorkspace(
	turn: CapturedTurn,
	captured: readonly CapturedTurn[],
): TurnDiffEnd {
	const position = captured.findIndex(
		(entry) => entry.checkpointId === turn.checkpointId,
	);
	const next = captured[position + 1];
	return next
		? { gitHash: next.checkpointHash, kind: 'checkpoint' }
		: { kind: 'unknown' };
}

/**
 * Groups turns by session, keeping each session's submission order.
 * @param turns - Every turn in the workspace
 * @returns Each session's turns, keyed by session id
 */
function groupBySession(
	turns: readonly TurnRangeInput[],
): ReadonlyMap<string, readonly TurnRangeInput[]> {
	const sessions = new Map<string, TurnRangeInput[]>();
	for (const turn of turns) {
		const session = sessions.get(turn.agentSessionId);
		if (session) {
			session.push(turn);
		} else {
			sessions.set(turn.agentSessionId, [turn]);
		}
	}
	return sessions;
}

/**
 * The captured turns ordered by when their checkpoints were written, which is
 * the order the workspace's snapshots actually happened in. Compares code units
 * rather than collating, so the order matches SQLite's `ORDER BY created_at, id`.
 * @param turns - Every turn in the workspace
 * @returns Captured turns, oldest checkpoint first
 */
function capturedInCaptureOrder(
	turns: readonly TurnRangeInput[],
): readonly CapturedTurn[] {
	return turns
		.filter(isCaptured)
		.sort(
			(left, right) =>
				compareCodeUnits(left.checkpointCreatedAt, right.checkpointCreatedAt) ||
				compareCodeUnits(left.checkpointId, right.checkpointId),
		);
}

/**
 * Orders two strings by UTF-16 code unit, the way SQLite's default collation does.
 * @param left - First string
 * @param right - Second string
 * @returns Negative, zero, or positive, as `Array.prototype.sort` expects
 */
function compareCodeUnits(left: string, right: string): number {
	if (left === right) {
		return 0;
	}
	return left < right ? -1 : 1;
}

/**
 * Whether a turn's pre-prompt capture produced a commit to diff from.
 * @param turn - The turn to check
 * @returns True when the turn has a captured checkpoint
 */
function isCaptured(turn: TurnRangeInput): turn is CapturedTurn {
	return (
		turn.checkpointHash !== null &&
		turn.checkpointCreatedAt !== null &&
		turn.checkpointId !== null
	);
}
