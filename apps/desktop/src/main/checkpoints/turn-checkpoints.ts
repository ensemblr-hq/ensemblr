import type { DatabaseSync } from 'node:sqlite';
import {
	type CheckpointRow,
	clearCheckpointEnd,
	deleteCheckpointForTurn,
	getCheckpointByTurnId,
	insertCheckpoint,
	markCheckpointEndFailed,
	setCheckpointEnd,
} from '../storage/repositories/index.ts';
import { createBoundaryQueue } from './boundary-queue.ts';
import {
	captureWorkspaceCheckpoint,
	pinCheckpointRef,
	sanitizeRefSegment,
} from './git-checkpoint.ts';

/**
 * Turn-boundary snapshots the agent session lifecycle takes (ADR 0012). A turn
 * opens at the snapshot taken as its input is submitted — a prompt, a steer, or
 * a follow-up — and ends at the snapshot taken when it stops: the runtime
 * settling, the user stopping it, or the next input arriving. Its diff is
 * locked to that range once the end lands.
 *
 * Safety policy: a failed capture WARNS and the prompt continues — blocking all
 * prompting on a degraded git state (or a non-git scratch workspace) is worse
 * than losing one turn's range. The failure is recorded rather than left as an
 * absence, so the resolver can tell a capture still being taken, whose turn
 * reads live meanwhile, from one that never landed, whose range it withholds.
 *
 * Operations for one workspace run one at a time, in the order they were
 * queued. That keeps a chat's boundaries in order — an end captured as a turn
 * settles lands before the next input's opening snapshot, and a reopen never
 * races the end it undoes — and stops two chats of the same workspace staging
 * its worktree at once. Chats in different workspaces still proceed together.
 */
export interface TurnCheckpointPort {
	/**
	 * Snapshots the workspace as an input is submitted, opening `turnId` there
	 * and ending `closingTurnId` — the turn the input interrupts, if one is still
	 * open — at the same commit.
	 * @returns The new turn's checkpoint, or null when capture failed
	 */
	openTurn: (input: OpenTurnInput) => Promise<CheckpointRow | null>;
	/** Snapshots where a turn stopped, locking its range; a no-op once it has an end. */
	endTurn: (input: TurnBoundaryInput) => Promise<void>;
	/**
	 * Ends a turn at a commit another turn's opening already captured — the turn
	 * a steer or follow-up interrupted, recorded only once the input has taken
	 * over. A no-op once the turn has an end, so one that settled while the
	 * input's snapshot was being taken keeps the end it settled at.
	 */
	endTurnAt: (
		input: TurnBoundaryInput & { commitHash: string; openingRef: string },
	) => Promise<void>;
	/** Drops a turn's end because the runtime resumed it after what looked like settling. */
	reopenTurn: (input: TurnBoundaryInput) => Promise<void>;
	/**
	 * Forgets the checkpoint of a turn whose input the runtime refused, so a turn
	 * that never ran does not stand as the next one's successor.
	 */
	discardTurn: (input: TurnBoundaryInput) => Promise<void>;
	/** Resolves once every queued boundary, in every session, has been written. */
	drain: () => Promise<void>;
	/** Resolves once every boundary queued so far for one session has been written. */
	flushSession: (agentSessionId: string) => Promise<void>;
}

/** Identifies the turn a boundary operation acts on. */
interface TurnBoundaryInput {
	agentSessionId: string;
	cwd: string;
	database: DatabaseSync;
	turnId: string;
	workspaceId: string;
}

/** What {@link TurnCheckpointPort.openTurn} needs to open a turn. */
interface OpenTurnInput extends TurnBoundaryInput {
	/** Open turn the input interrupts, ended at the same snapshot; null when none is. */
	closingTurnId: string | null;
	label: string;
}

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

/**
 * Builds the private ref that pins a turn's end commit, beside its opening ref.
 * @param turnId - Turn whose end the ref pins
 * @param workspaceId - Workspace the turn ran in
 * @returns The fully-qualified ref name
 */
function endRefFor({
	turnId,
	workspaceId,
}: {
	turnId: string;
	workspaceId: string;
}): string {
	return `${checkpointRefFor({ turnId, workspaceId })}-end`;
}

/**
 * Creates the production turn-boundary port (git + SQLite).
 * @param capture - Takes each snapshot; only tests replace it, to hold captures
 *   in flight and watch what overlaps
 * @param now - Clock stamping when a turn ended
 * @param onChanged - Told the workspace whose turn ranges moved, after every
 *   boundary that wrote one, so the renderer re-reads them as they land rather
 *   than once the turn that moved them finishes
 * @returns The port
 */
export function createTurnCheckpoints({
	capture = captureWorkspaceCheckpoint,
	now = () => new Date(),
	onChanged,
}: {
	capture?: typeof captureWorkspaceCheckpoint;
	now?: () => Date;
	onChanged?: (workspaceId: string) => void;
} = {}): TurnCheckpointPort {
	const queue = createBoundaryQueue();
	const inOrder = queue.run;
	const changed = (workspaceId: string): void =>
		notifyChanged(onChanged, workspaceId);
	return {
		discardTurn: (input) =>
			inOrder(input, async () => {
				if (
					deleteCheckpointForTurn({
						database: input.database,
						turnId: input.turnId,
					})
				) {
					changed(input.workspaceId);
				}
			}),
		drain: queue.drain,
		flushSession: queue.flushSession,
		endTurnAt: ({ commitHash, openingRef, ...input }) =>
			inOrder(input, async () => {
				const checkpoint = getCheckpointByTurnId({
					database: input.database,
					turnId: input.turnId,
				});
				if (!checkpoint?.gitHash || checkpoint.endedAt) {
					return;
				}
				await recordTurnEnd({
					...input,
					commitHash,
					endedAt: now(),
					openingRef,
				});
				changed(input.workspaceId);
			}),
		endTurn: (input) =>
			inOrder(input, async () => {
				if (await endTurnNow({ ...input, capture, endedAt: now() })) {
					changed(input.workspaceId);
				}
			}),
		openTurn: (input) =>
			inOrder(input, async () => {
				const checkpoint = await openTurnNow({
					...input,
					capture,
					endedAt: now(),
				});
				changed(input.workspaceId);
				return checkpoint;
			}),
		reopenTurn: (input) =>
			inOrder(input, async () => {
				if (
					clearCheckpointEnd({ database: input.database, turnId: input.turnId })
				) {
					changed(input.workspaceId);
				}
			}),
	};
}

/**
 * Captures the snapshot an input opens its turn at, and ends the turn it
 * interrupts at the same commit. A failed capture still writes the new turn's
 * row, without a commit, and marks the interrupted turn's end as lost.
 * @param input - The turn to open, the one to close, when, and how to capture
 * @returns The new turn's checkpoint, or null when capture failed
 */
async function openTurnNow({
	agentSessionId,
	capture,
	closingTurnId,
	cwd,
	database,
	endedAt,
	label,
	turnId,
	workspaceId,
}: OpenTurnInput & {
	capture: typeof captureWorkspaceCheckpoint;
	endedAt: Date;
}): Promise<CheckpointRow | null> {
	const ref = checkpointRefFor({ turnId, workspaceId });
	try {
		const captured = await capture({
			cwd,
			message: `ensemblr checkpoint: ${label}`,
			ref,
		});
		const checkpoint = insertCheckpoint({
			database,
			input: {
				agentSessionId,
				gitHash: captured.commitHash,
				gitRef: captured.ref,
				label,
				metadata: { recordsEnd: true, treeHash: captured.treeHash },
				turnId,
				workspaceId,
			},
		});
		if (closingTurnId) {
			await recordTurnEnd({
				commitHash: captured.commitHash,
				cwd,
				database,
				endedAt,
				openingRef: captured.ref,
				turnId: closingTurnId,
				workspaceId,
			});
		}
		return checkpoint;
	} catch (error) {
		console.warn('[checkpoints] capture failed; prompt continues', {
			cwd,
			error: error instanceof Error ? error.message : String(error),
			ref,
			turnId,
			workspaceId,
		});
		recordFailedOpening({
			agentSessionId,
			closingTurnId,
			database,
			endedAt,
			label,
			ref,
			turnId,
			workspaceId,
		});
		return null;
	}
}

/**
 * Records that a turn's opening capture never landed, and that the turn it
 * interrupted therefore has no end. Best-effort: the capture already failed,
 * and a database that refuses these rows too leaves both turns without a range
 * either way.
 * @param input - The turn that failed to open, the one it interrupted, and when
 */
function recordFailedOpening({
	agentSessionId,
	closingTurnId,
	database,
	endedAt,
	label,
	ref,
	turnId,
	workspaceId,
}: {
	agentSessionId: string;
	closingTurnId: string | null;
	database: DatabaseSync;
	endedAt: Date;
	label: string;
	ref: string;
	turnId: string;
	workspaceId: string;
}): void {
	try {
		insertCheckpoint({
			database,
			input: {
				agentSessionId,
				gitHash: null,
				gitRef: ref,
				label,
				metadata: { recordsEnd: true },
				reason: 'capture-failed',
				turnId,
				workspaceId,
			},
		});
		if (closingTurnId) {
			markCheckpointEndFailed({
				database,
				endedAt: endedAt.toISOString(),
				turnId: closingTurnId,
			});
		}
	} catch (error) {
		console.warn('[checkpoints] could not record the failed capture', {
			error: error instanceof Error ? error.message : String(error),
			turnId,
		});
	}
}

/**
 * Captures where a turn stopped and records it as the turn's end, or records
 * the end as lost when the capture fails. Skips a turn with no opening
 * checkpoint, which has no range to close, and one whose end was already
 * recorded or lost, so a shutdown after the turn settled does not move it.
 * @param input - The turn to end, when it ended, and how to capture
 * @returns Whether the turn's end changed
 */
async function endTurnNow({
	capture,
	cwd,
	database,
	endedAt,
	turnId,
	workspaceId,
}: TurnBoundaryInput & {
	capture: typeof captureWorkspaceCheckpoint;
	endedAt: Date;
}): Promise<boolean> {
	const checkpoint = getCheckpointByTurnId({ database, turnId });
	if (!checkpoint?.gitHash || checkpoint.endedAt) {
		return false;
	}
	const ref = endRefFor({ turnId, workspaceId });
	try {
		const captured = await capture({
			cwd,
			message: `ensemblr checkpoint end: ${checkpoint.label}`,
			ref,
		});
		return setCheckpointEnd({
			database,
			endedAt: endedAt.toISOString(),
			gitHash: captured.commitHash,
			gitRef: ref,
			turnId,
		});
	} catch (error) {
		console.warn('[checkpoints] end capture failed; turn diff withheld', {
			cwd,
			error: error instanceof Error ? error.message : String(error),
			ref,
			turnId,
			workspaceId,
		});
		return markCheckpointEndFailed({
			database,
			endedAt: endedAt.toISOString(),
			turnId,
		});
	}
}

/**
 * Ends a turn at a commit the next turn's opening capture produced, pinning it
 * under the turn's own end ref so it stays reachable whatever happens to that
 * capture. When the pin fails the end is still recorded, held by the opening
 * ref instead: the commit is the exact end either way.
 * @param input - The commit, the ref already holding it, the turn it ends, and when
 */
async function recordTurnEnd({
	commitHash,
	cwd,
	database,
	endedAt,
	openingRef,
	turnId,
	workspaceId,
}: {
	commitHash: string;
	cwd: string;
	database: DatabaseSync;
	endedAt: Date;
	openingRef: string;
	turnId: string;
	workspaceId: string;
}): Promise<void> {
	const ref = endRefFor({ turnId, workspaceId });
	const pinned = await pinCheckpointRef({ commitHash, cwd, ref }).then(
		() => true,
		(error: unknown) => {
			console.warn('[checkpoints] could not pin the interrupted turn end', {
				error: error instanceof Error ? error.message : String(error),
				ref,
				turnId,
			});
			return false;
		},
	);
	setCheckpointEnd({
		database,
		endedAt: endedAt.toISOString(),
		gitHash: commitHash,
		gitRef: pinned ? ref : openingRef,
		turnId,
	});
}

/**
 * Reports a workspace whose turn ranges moved. A listener that throws must not
 * turn a boundary that landed into one that failed.
 * @param onChanged - The listener, when one was given
 * @param workspaceId - The workspace to report
 */
function notifyChanged(
	onChanged: ((workspaceId: string) => void) | undefined,
	workspaceId: string,
): void {
	try {
		onChanged?.(workspaceId);
	} catch (error) {
		console.warn('[checkpoints] boundary listener failed', {
			error: error instanceof Error ? error.message : String(error),
			workspaceId,
		});
	}
}
