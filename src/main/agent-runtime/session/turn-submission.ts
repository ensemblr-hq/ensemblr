import type { DatabaseSync } from 'node:sqlite';
import type { AgentProviderId } from '../../../shared/agent-provider.ts';
import type { SubmitAgentPromptRequest as SubmitAgentPromptWireRequest } from '../../../shared/ipc/contracts/agent-session';
import {
	type AgentSessionRow,
	createTurn,
	getAgentSessionById,
	getTurnById,
	updateAgentSession,
	updateTurn,
} from '../../storage/repositories/agent-session-repository.ts';
import { AgentSessionServiceError } from '../agent-session-service-error.ts';
import { AgentSubmitError } from '../agent-types.ts';
import {
	type ActiveSession,
	type ActiveSessionMap,
	isTurnInFlight,
} from './active-session.ts';
import type { SupersededTurn, TurnBoundaries } from './turn-boundaries.ts';

/**
 * Lifecycle-side submit request. Extends the wire shape with the runtime the
 * requested model needs, which the main process derives from its own catalog so
 * a mid-conversation model switch cannot cross the session's provider pin.
 */
export interface AgentSessionSubmitRequest
	extends SubmitAgentPromptWireRequest {
	provider?: AgentProviderId;
}

/** Result of submitting a prompt to an open agent session. */
export interface AgentSessionSubmitResult {
	acceptedAt: string;
	turnId: string;
}

/** Opens a turn for each input an open session receives and hands it to the runtime. */
interface TurnSubmitter {
	/** Whether a session's runtime is being torn down after an unconfirmed submit. */
	isQuarantining: (sessionId: string) => boolean;
	/**
	 * Submits a prompt, steer, or follow-up to an open session. Steers and
	 * follow-ups to one session run one at a time, so each snapshots after the
	 * one before it has switched the session to its own turn. One that reaches a
	 * session no longer running a turn — the composer steered as the agent
	 * finished — goes as an ordinary prompt instead, so its turn is marked as
	 * running rather than read as a turn whose runtime went away.
	 */
	submit: (input: {
		active: ActiveSession;
		database: DatabaseSync;
		request: AgentSessionSubmitRequest;
	}) => Promise<AgentSessionSubmitResult>;
}

/**
 * Builds the submit paths over the active-session map: opening the turn,
 * snapshotting the workspace, submitting to the runtime, and rolling back or
 * quarantining when the runtime refuses the input or cannot confirm it.
 * @param activeSessions - Live session map
 * @param isAfkModeActive - Reads a session's AFK state for a prompt
 * @param isPlanModeActive - Reads a session's Plan Mode state for a prompt
 * @param now - Clock stamping when a turn settled or a session closed
 * @param turnBoundaries - Turn-row and checkpoint bookkeeping
 * @returns The submitter
 */
export function createTurnSubmitter({
	activeSessions,
	isAfkModeActive,
	isPlanModeActive,
	now,
	turnBoundaries,
}: {
	activeSessions: ActiveSessionMap;
	isAfkModeActive: (agentSessionId: string) => boolean;
	isPlanModeActive: (agentSessionId: string) => boolean;
	now: () => Date;
	turnBoundaries: TurnBoundaries;
}): TurnSubmitter {
	const quarantiningSessions = new Set<string>();
	const interjectionTails = new Map<string, Promise<void>>();

	/**
	 * Errors a turn unless it already settled as completed or errored.
	 * @param database - Database holding the turn row
	 * @param turnId - Turn to error
	 */
	const errorUnsettledTurn = (database: DatabaseSync, turnId: string): void => {
		const turnRow = getTurnById({ database, id: turnId });
		if (
			turnRow &&
			turnRow.status !== 'completed' &&
			turnRow.status !== 'errored'
		) {
			updateTurn({
				database,
				id: turnId,
				patch: { completedAt: now().toISOString(), status: 'errored' },
			});
		}
	};

	/**
	 * Whether the session's live binding is still the one that submitted `turnId`
	 * and still runs that turn; a vanished binding counts as still owning it.
	 * @param active - The binding that submitted the turn
	 * @param sessionId - Session the turn belongs to
	 * @param turnId - Turn whose ownership is checked
	 * @returns True when nothing newer replaced the binding or the turn
	 */
	const ownsTurn = (
		active: ActiveSession,
		sessionId: string,
		turnId: string,
	): boolean => {
		const current = activeSessions.get(sessionId);
		return (
			!current ||
			(current.agentRuntimeSession === active.agentRuntimeSession &&
				current.activeTurnId === turnId)
		);
	};

	/**
	 * Quarantines a runtime when prompt delivery cannot be confirmed.
	 * @param active - The binding that owns the uncertain prompt.
	 * @param database - Database holding the session and turn rows.
	 * @param sessionId - Session whose runtime is being quarantined.
	 * @param turnId - Turn whose delivery is uncertain.
	 * @returns A promise that settles after the runtime is terminated.
	 */
	const quarantineUnconfirmedSubmit = async ({
		active,
		database,
		sessionId,
		turnId,
	}: {
		active: ActiveSession;
		database: DatabaseSync;
		sessionId: string;
		turnId: string;
	}): Promise<void> => {
		if (!ownsTurn(active, sessionId, turnId)) {
			errorUnsettledTurn(database, turnId);
			return;
		}
		quarantiningSessions.add(sessionId);
		try {
			await active.agentRuntimeSession.close();
		} catch {
			// Quarantine still removes the binding; no automatic resend is safe.
		} finally {
			active.subscription.unsubscribe();
			const ownsTurnAfterClose = ownsTurn(active, sessionId, turnId);
			errorUnsettledTurn(database, turnId);
			if (ownsTurnAfterClose) {
				updateAgentSession({
					database,
					id: sessionId,
					patch: { closedAt: now().toISOString(), status: 'closed' },
				});
				activeSessions.delete(sessionId);
			}
			quarantiningSessions.delete(sessionId);
		}
	};

	/**
	 * Rolls back a prompt rejected before runtime execution, without clobbering
	 * newer work, and quarantines the runtime when delivery is unconfirmed.
	 * @param input - The rejected prompt's binding, cause, and turn bookkeeping
	 */
	const recoverRejectedSubmit = async ({
		active,
		cause,
		database,
		previousStatus,
		sessionId,
		superseded,
		turnId,
	}: {
		active: ActiveSession;
		cause: unknown;
		database: DatabaseSync;
		previousStatus: AgentSessionRow['status'];
		sessionId: string;
		superseded: SupersededTurn | null;
		turnId: string;
	}): Promise<void> => {
		if (isUnconfirmedSubmit(cause)) {
			await quarantineUnconfirmedSubmit({
				active,
				database,
				sessionId,
				turnId,
			});
			return;
		}
		const current = activeSessions.get(sessionId);
		const currentRow = getAgentSessionById({ database, id: sessionId });
		if (!turnBoundaries.rejectTurn({ active, database, superseded, turnId })) {
			return;
		}
		if (
			previousStatus !== 'streaming' &&
			current?.activeTurnId === turnId &&
			currentRow?.status === 'streaming'
		) {
			updateAgentSession({
				database,
				id: sessionId,
				patch: { status: 'idle' },
			});
		}
	};

	/**
	 * Opens a turn for a steer or follow-up. Both runtimes put the user's message
	 * on the timeline the moment it is submitted, so it starts a new turn there
	 * and then: the turn it interrupts ends at the new turn's opening snapshot,
	 * and events after the switch are tagged with the new turn. The session
	 * keeps streaming. A stop or replacement during the snapshot, or a refused
	 * submit, errors the new turn and discards its checkpoint; an unconfirmed
	 * submit leaves it active, since the runtime may have taken it.
	 * @param active - The session the input is submitted to
	 * @param database - Database holding the session and turn rows
	 * @param request - The steer or follow-up
	 * @returns The runtime's acknowledgement
	 */
	const submitInterjection = async ({
		active,
		database,
		request,
	}: {
		active: ActiveSession;
		database: DatabaseSync;
		request: AgentSessionSubmitRequest;
	}): Promise<AgentSessionSubmitResult> => {
		const turn = createTurn({
			database,
			input: { branchId: active.branch.id, promptText: request.prompt },
		});
		const opening = await turnBoundaries.beginInterjectionTurn({
			active,
			database,
			prompt: request.prompt,
			turnId: turn.id,
		});
		if (!opening.switched) {
			turnBoundaries.rejectTurn({
				active,
				database,
				superseded: null,
				turnId: turn.id,
			});
			throw sessionNotOpen(request.sessionId);
		}
		try {
			return await active.agentRuntimeSession.submit({
				prompt: request.prompt,
				streamingBehavior: request.streamingBehavior,
			});
		} catch (cause) {
			if (!isUnconfirmedSubmit(cause)) {
				turnBoundaries.rejectTurn({
					active,
					database,
					superseded: opening.superseded,
					turnId: turn.id,
				});
			}
			throw cause;
		}
	};

	/**
	 * Runs a session's steers and follow-ups one after another, re-reading the
	 * live binding once the previous one has settled. The session may have
	 * finished its turn while this input waited, so it is re-checked then: an
	 * input that no longer has a running turn to steer goes as a prompt.
	 * @param database - Database holding the session and turn rows
	 * @param request - The steer or follow-up
	 * @returns The runtime's acknowledgement
	 */
	const submitSerializedInterjection = (
		database: DatabaseSync,
		request: AgentSessionSubmitRequest,
	): Promise<AgentSessionSubmitResult> => {
		const sessionId = request.sessionId;
		const previous = interjectionTails.get(sessionId) ?? Promise.resolve();
		const result = previous.then(() => {
			const active = activeSessions.get(sessionId);
			if (!active || quarantiningSessions.has(sessionId)) {
				throw sessionNotOpen(sessionId);
			}
			return isTurnInFlight(database, sessionId)
				? submitInterjection({ active, database, request })
				: submitTurnPrompt({ active, database, request });
		});
		const tail = result.then(
			() => undefined,
			() => undefined,
		);
		interjectionTails.set(sessionId, tail);
		void tail.then(() => {
			if (interjectionTails.get(sessionId) === tail) {
				interjectionTails.delete(sessionId);
			}
		});
		return result;
	};

	/**
	 * Opens a turn for a prompt, snapshotting the workspace before the runtime can
	 * touch files. A turn still open when the prompt arrives ends at that same
	 * snapshot.
	 * @param active - The session the prompt is submitted to
	 * @param database - Database holding the session and turn rows
	 * @param request - The prompt
	 * @returns The runtime's acknowledgement
	 */
	const submitTurnPrompt = async ({
		active,
		database,
		request,
	}: {
		active: ActiveSession;
		database: DatabaseSync;
		request: AgentSessionSubmitRequest;
	}): Promise<AgentSessionSubmitResult> => {
		const previousStatus =
			getAgentSessionById({
				database,
				id: request.sessionId,
			})?.status ?? 'idle';
		const turn = createTurn({
			database,
			input: {
				branchId: active.branch.id,
				model: request.model ?? null,
				promptText: request.prompt,
				thinkingLevel: request.thinkingLevel ?? null,
			},
		});
		updateAgentSession({
			database,
			id: request.sessionId,
			patch: {
				model: request.model ?? active.row.model,
				status: 'streaming',
				thinkingLevel: request.thinkingLevel ?? active.row.thinkingLevel,
			},
		});
		const superseded = await turnBoundaries.beginTurn({
			active,
			database,
			prompt: request.prompt,
			resetsPendingSummary: true,
			turnId: turn.id,
		});

		try {
			return await active.agentRuntimeSession.submit({
				modelOverride: request.model ?? undefined,
				planMode: request.planMode ?? isPlanModeActive(request.sessionId),
				afkMode: request.afkMode ?? isAfkModeActive(request.sessionId),
				prompt: request.prompt,
				thinkingLevel: request.thinkingLevel ?? undefined,
			});
		} catch (cause) {
			await recoverRejectedSubmit({
				active,
				cause,
				database,
				previousStatus,
				sessionId: request.sessionId,
				superseded,
				turnId: turn.id,
			});
			throw cause;
		}
	};

	return {
		isQuarantining: (sessionId) => quarantiningSessions.has(sessionId),
		submit: ({ active, database, request }) =>
			request.streamingBehavior && isTurnInFlight(database, request.sessionId)
				? submitSerializedInterjection(database, request)
				: submitTurnPrompt({ active, database, request }),
	};
}

/**
 * Whether a submit failure leaves open that the runtime received the input.
 * @param cause - The error the runtime's submit threw
 * @returns True for an unconfirmed delivery
 */
function isUnconfirmedSubmit(cause: unknown): boolean {
	return (
		cause instanceof AgentSubmitError && cause.disposition === 'unconfirmed'
	);
}

/**
 * The error a submit to a session with no live runtime binding fails with.
 * @param sessionId - Session the input was submitted to
 * @returns The service error
 */
export function sessionNotOpen(sessionId: string): AgentSessionServiceError {
	return new AgentSessionServiceError({
		code: 'session-not-open',
		message: `Agent session ${sessionId} is not open.`,
	});
}
