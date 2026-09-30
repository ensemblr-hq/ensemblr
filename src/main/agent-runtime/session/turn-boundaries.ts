import type { DatabaseSync } from 'node:sqlite';
import type { TurnCheckpointPort } from '../../checkpoints';
import {
	type AgentTurnRow,
	type AgentTurnStatus,
	getTurnById,
	updateTurn,
} from '../../storage/repositories/agent-session-repository.ts';
import type { ActiveSession, ActiveSessionMap } from './active-session.ts';

/**
 * A turn an input settled because it interrupted it, with the status it held
 * before, so a rejected input can hand the turn back unchanged.
 */
export interface SupersededTurn {
	id: string;
	status: AgentTurnStatus;
}

/**
 * Outcome of opening a steer or follow-up turn. `switched` is false when the
 * session was stopped or replaced while the opening snapshot was taken, in
 * which case the new turn never became active.
 */
type InterjectionOpening =
	| { superseded: SupersededTurn | null; switched: true }
	| { switched: false };

/**
 * Turn-row and checkpoint bookkeeping at every turn boundary. A turn ends when
 * the runtime settles, when the user stops it, or when the next input arrives,
 * and its checkpoint range locks at that moment (ADR 0012). Checkpoint writes
 * are fire-and-forget except the opening snapshot, which must land before the
 * runtime can touch files.
 */
export interface TurnBoundaries {
	/**
	 * Makes `turnId` the session's active turn as a prompt arrives, settling the
	 * turn it interrupts, then snapshots the workspace to open the new turn and
	 * end the interrupted one at the same commit. The map entry is replaced
	 * before the first await, so a concurrent input or stop already sees the new
	 * turn; the runtime is idle, so nothing streams under the wrong turn.
	 * @returns The interrupted turn, for {@link TurnBoundaries.rejectTurn}
	 */
	beginTurn: (input: {
		active: ActiveSession;
		database: DatabaseSync;
		prompt: string;
		resetsPendingSummary: boolean;
		turnId: string;
	}) => Promise<SupersededTurn | null>;
	/**
	 * Opens `turnId` for a steer or follow-up. The runtime is still streaming the
	 * turn it interrupts, so the snapshot is awaited while that turn stays active
	 * and open: what it streams during the capture keeps its own id. The switch
	 * happens afterwards, and only when the session still runs the same runtime
	 * on the same turn it did before the capture. The interrupted turn is ended
	 * at the snapshot only once the switch lands, so a turn that stopped or
	 * settled during the capture keeps the end it stopped at.
	 * @returns Whether the switch happened, with the turn it interrupted
	 */
	beginInterjectionTurn: (input: {
		active: ActiveSession;
		database: DatabaseSync;
		prompt: string;
		turnId: string;
	}) => Promise<InterjectionOpening>;
	/** Returns the session's active turn when it is still open, otherwise null. */
	openTurnIdOf: (input: {
		active: ActiveSession;
		database: DatabaseSync;
	}) => string | null;
	/** Undoes a settle the runtime contradicted by streaming again on the same turn. */
	reopenSettledTurn: (input: {
		active: ActiveSession;
		database: DatabaseSync;
	}) => void;
	/**
	 * Errors a turn whose input the runtime refused, discards its checkpoint so
	 * a turn that never ran does not end its predecessor's range, and hands the
	 * turn it superseded back to the session, unless newer work replaced it.
	 * @returns False when the turn had already aborted or errored
	 */
	rejectTurn: (input: {
		active: ActiveSession;
		database: DatabaseSync;
		superseded: SupersededTurn | null;
		turnId: string;
	}) => boolean;
	/** Settles the session's active turn with `status` and locks its range; false when it was not open. */
	settleOpenTurn: (input: {
		active: ActiveSession;
		database: DatabaseSync;
		status: AgentTurnStatus;
	}) => boolean;
	/**
	 * Settles a turn a stop interrupted. When the runtime already settled it as
	 * completed while winding down, only the status is corrected to `status`.
	 */
	settleStoppedTurn: (input: {
		active: ActiveSession;
		database: DatabaseSync;
		status: AgentTurnStatus;
		turnId: string;
	}) => void;
}

/**
 * Builds the turn-boundary bookkeeping over the active-session map.
 * @param activeSessions - Live session map, read to hand a superseded turn back
 * @param now - Clock stamping when a turn settled
 * @param turnCheckpoints - Checkpoint port; absent means no snapshots are taken
 * @returns The boundary operations
 */
export function createTurnBoundaries({
	activeSessions,
	now,
	turnCheckpoints,
}: {
	activeSessions: ActiveSessionMap;
	now: () => Date;
	turnCheckpoints: TurnCheckpointPort | undefined;
}): TurnBoundaries {
	/**
	 * Settles a turn row and asks the port to lock its range.
	 * @param active - Session that ran the turn
	 * @param database - Open session database
	 * @param status - Status to settle the turn with
	 * @param turnId - Turn to settle
	 */
	const settle = ({
		active,
		database,
		status,
		turnId,
	}: {
		active: ActiveSession;
		database: DatabaseSync;
		status: AgentTurnStatus;
		turnId: string;
	}): void => {
		updateTurn({
			database,
			id: turnId,
			patch: { completedAt: now().toISOString(), status },
		});
		if (turnCheckpoints) {
			runDetached(
				'end',
				turnCheckpoints.endTurn(boundaryFor({ active, database, turnId })),
			);
		}
	};

	/**
	 * Reads a turn row when it is still open.
	 * @param database - Open session database
	 * @param turnId - Turn to read, or null for none
	 * @returns The open turn row, or null
	 */
	const readOpenTurn = (
		database: DatabaseSync,
		turnId: string | null,
	): AgentTurnRow | null => {
		const turn = turnId ? getTurnById({ database, id: turnId }) : null;
		return turn && isOpenTurnStatus(turn.status) ? turn : null;
	};

	/**
	 * Settles the session's open active turn because a new input interrupts it.
	 * Its range is ended by the new turn's opening snapshot, not separately.
	 * @param active - Session the input was submitted to
	 * @param database - Open session database
	 * @returns The interrupted turn, or null when none was open
	 */
	const supersedeOpenTurn = (
		active: ActiveSession,
		database: DatabaseSync,
	): SupersededTurn | null => {
		const turn = readOpenTurn(database, active.activeTurnId);
		if (!turn) {
			return null;
		}
		updateTurn({
			database,
			id: turn.id,
			patch: { completedAt: now().toISOString(), status: 'completed' },
		});
		return { id: turn.id, status: turn.status };
	};

	/**
	 * Hands a superseded turn back to the session after the input that
	 * interrupted it was refused, unless newer work already replaced that input.
	 * @param database - Open session database
	 * @param sessionId - Session the refused input was submitted to
	 * @param superseded - The interrupted turn and the status it held
	 * @param supersedingTurnId - Turn the refused input opened
	 */
	const restoreSupersededTurn = (
		database: DatabaseSync,
		sessionId: string,
		superseded: SupersededTurn,
		supersedingTurnId: string,
	): void => {
		const current = activeSessions.get(sessionId);
		if (current?.activeTurnId !== supersedingTurnId) {
			return;
		}
		activeSessions.set(sessionId, { ...current, activeTurnId: superseded.id });
		updateTurn({
			database,
			id: superseded.id,
			patch: { completedAt: null, status: superseded.status },
		});
		if (turnCheckpoints) {
			runDetached(
				'reopen',
				turnCheckpoints.reopenTurn(
					boundaryFor({ active: current, database, turnId: superseded.id }),
				),
			);
		}
	};

	return {
		beginTurn: async ({
			active,
			database,
			prompt,
			resetsPendingSummary,
			turnId,
		}) => {
			const superseded = supersedeOpenTurn(active, database);
			activeSessions.set(active.row.id, {
				...active,
				activeTurnId: turnId,
				...(resetsPendingSummary ? { agentResponsePendingSummary: false } : {}),
			});
			await turnCheckpoints?.openTurn({
				...boundaryFor({ active, database, turnId }),
				closingTurnId: superseded?.id ?? null,
				label: summarizePromptForLabel(prompt),
			});
			return superseded;
		},
		beginInterjectionTurn: async ({ active, database, prompt, turnId }) => {
			const interruptedTurnId = active.activeTurnId;
			const opening = await turnCheckpoints?.openTurn({
				...boundaryFor({ active, database, turnId }),
				closingTurnId: null,
				label: summarizePromptForLabel(prompt),
			});
			const current = activeSessions.get(active.row.id);
			if (
				current?.agentRuntimeSession !== active.agentRuntimeSession ||
				current.activeTurnId !== interruptedTurnId
			) {
				return { switched: false };
			}
			const superseded = supersedeOpenTurn(current, database);
			activeSessions.set(active.row.id, { ...current, activeTurnId: turnId });
			if (superseded && opening?.gitHash && turnCheckpoints) {
				runDetached(
					'end',
					turnCheckpoints.endTurnAt({
						...boundaryFor({
							active: current,
							database,
							turnId: superseded.id,
						}),
						commitHash: opening.gitHash,
						openingRef: opening.gitRef,
					}),
				);
			}
			// An end the interrupted turn queued by settling during the capture
			// must be written before the runtime can act on the new input.
			await turnCheckpoints?.flushSession(active.row.id);
			return { superseded, switched: true };
		},
		openTurnIdOf: ({ active, database }) =>
			readOpenTurn(database, active.activeTurnId)?.id ?? null,
		reopenSettledTurn: ({ active, database }) => {
			const turnId = active.activeTurnId;
			const turn = turnId ? getTurnById({ database, id: turnId }) : null;
			if (!turnId || turn?.status !== 'completed') {
				return;
			}
			updateTurn({
				database,
				id: turnId,
				patch: { completedAt: null, status: 'submitted' },
			});
			if (turnCheckpoints) {
				runDetached(
					'reopen',
					turnCheckpoints.reopenTurn(boundaryFor({ active, database, turnId })),
				);
			}
		},
		rejectTurn: ({ active, database, superseded, turnId }) => {
			const turn = getTurnById({ database, id: turnId });
			if (!turn || turn.status === 'aborted' || turn.status === 'errored') {
				return false;
			}
			updateTurn({
				database,
				id: turnId,
				patch: { completedAt: now().toISOString(), status: 'errored' },
			});
			if (turnCheckpoints) {
				runDetached(
					'discard',
					turnCheckpoints.discardTurn(
						boundaryFor({ active, database, turnId }),
					),
				);
			}
			if (superseded) {
				restoreSupersededTurn(database, active.row.id, superseded, turnId);
			}
			return true;
		},
		settleOpenTurn: ({ active, database, status }) => {
			const turn = readOpenTurn(database, active.activeTurnId);
			if (!turn) {
				return false;
			}
			settle({ active, database, status, turnId: turn.id });
			return true;
		},
		settleStoppedTurn: ({ active, database, status, turnId }) => {
			const turn = getTurnById({ database, id: turnId });
			if (turn && isOpenTurnStatus(turn.status)) {
				settle({ active, database, status, turnId });
				return;
			}
			if (turn?.status === 'completed' && status === 'aborted') {
				updateTurn({ database, id: turnId, patch: { status } });
			}
		},
	};
}

/**
 * Whether a turn status means the turn has not settled yet.
 * @param status - Persisted turn status
 * @returns True for a turn still running or waiting to run
 */
function isOpenTurnStatus(status: AgentTurnStatus): boolean {
	return status === 'submitted' || status === 'streaming';
}

/**
 * Builds the port input identifying one turn of a session.
 * @param active - Session that owns the turn
 * @param database - Open session database
 * @param turnId - Turn the boundary acts on
 * @returns The port's boundary input
 */
function boundaryFor({
	active,
	database,
	turnId,
}: {
	active: ActiveSession;
	database: DatabaseSync;
	turnId: string;
}) {
	return {
		agentSessionId: active.row.id,
		cwd: active.row.cwd,
		database,
		turnId,
		workspaceId: active.row.workspaceId,
	};
}

/**
 * Lets a checkpoint write finish in the background. The port is serialized per
 * workspace and warns on git failures itself; this only keeps a database failure
 * from surfacing as an unhandled rejection.
 * @param operation - Which boundary the write records, for the warning
 * @param write - The pending port call
 */
function runDetached(
	operation: 'discard' | 'end' | 'reopen',
	write: Promise<void>,
): void {
	write.catch((error: unknown) => {
		console.warn('[agent-session] turn checkpoint write failed', {
			error: error instanceof Error ? error.message : String(error),
			operation,
		});
	});
}

/**
 * First line of the prompt, trimmed to a short checkpoint label.
 * @param prompt - The submitted prompt text
 * @returns The label
 */
function summarizePromptForLabel(prompt: string): string {
	const firstLine =
		prompt.split('\n').find((line) => line.trim().length > 0) ?? '';
	const trimmed = firstLine.trim();
	if (trimmed.length === 0) {
		return 'Checkpoint';
	}
	return trimmed.length > 80 ? `${trimmed.slice(0, 79)}…` : trimmed;
}
