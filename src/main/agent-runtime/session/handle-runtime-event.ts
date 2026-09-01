import type { DatabaseSync } from 'node:sqlite';
import type { AgentEventRow } from '../../storage/repositories';
import {
	type AgentTurnStatus,
	getAgentSessionById,
	updateAgentSession,
	updateTurn,
} from '../../storage/repositories/agent-session-repository.ts';
import type { AgentSessionEventSink } from '../agent-session-types.ts';
import type {
	AgentEvent,
	AgentSessionStatus,
	AgentShutdownReason,
} from '../agent-types.ts';
import type { SessionNamingInput } from '../naming/session-naming.ts';
import {
	type ActiveSession,
	type ActiveSessionMap,
	isTurnInFlight,
} from './active-session.ts';
import type { SummaryQueue } from './summary-queue.ts';

/** Lifecycle calls this to mirror runtime events into `agent_session_events`. */
export type PersistRuntimeEventPort = (input: {
	branchId: string;
	database: DatabaseSync;
	event: AgentEvent;
	sessionId: string;
	turnId: string | null;
}) => AgentEventRow | null;

/** Dependencies for {@link createRuntimeEventHandler}. */
interface RuntimeEventHandlerOptions {
	activeSessions: ActiveSessionMap;
	eventSink: AgentSessionEventSink | undefined;
	now: () => Date;
	persistRuntimeEvent: PersistRuntimeEventPort;
	/** Retries the derived tab title at every turn boundary; self-gates. */
	queueNaming: (input: SessionNamingInput) => void;
	summaryQueue: SummaryQueue;
}

/** Handler that persists a normalized runtime event and schedules summary refreshes. */
interface RuntimeEventHandler {
	handle: (input: {
		branchId: string;
		database: DatabaseSync;
		event: AgentEvent;
		sessionId: string;
	}) => void;
}

/**
 * Persists one normalized runtime event and schedules summary refreshes.
 *
 * Side-effect ordering is load-bearing: persistence write → snapshot/broadcast
 * → agent-end fan-out (sets `agentResponsePendingSummary`) → status/shutdown
 * patches → summary queue check. Reordering risks race regressions where a
 * summary write fires before the latest message_end is persisted.
 *
 * Summary writes are NOT drained on the agent `message` event — only at turn
 * boundaries (`status: 'idle'`) and on `shutdown`. This keeps `.context/` from
 * materializing mid-turn, so a first-turn scaffolder (e.g. `create-next-app`)
 * runs against an empty workspace root. Close paths flush explicitly (see
 * `shutdownActiveSessions`).
 */
export function createRuntimeEventHandler({
	activeSessions,
	eventSink,
	now,
	persistRuntimeEvent,
	queueNaming,
	summaryQueue,
}: RuntimeEventHandlerOptions): RuntimeEventHandler {
	/**
	 * Fast path for live message deltas: synthesizes an ephemeral row with a
	 * fractional ordinal between the last persisted event and the next one and
	 * broadcasts it directly, skipping the `BEGIN IMMEDIATE` write per token. The
	 * authoritative `message_end` still persists the full text so a refetch
	 * rehydrates correctly.
	 * @param active - The live session, when it is still in the active map
	 * @param branchId - Branch the event belongs to
	 * @param event - The normalized runtime event
	 * @param sessionId - Session the event belongs to
	 * @returns True when the event was a delta this broadcast, false to fall through to persistence
	 */
	const tryBroadcastDelta = ({
		active,
		branchId,
		event,
		sessionId,
	}: {
		active: ActiveSession | undefined;
		branchId: string;
		event: AgentEvent;
		sessionId: string;
	}): boolean => {
		if (
			event.type !== 'message' ||
			(event.payload.kind !== 'text-delta' &&
				event.payload.kind !== 'reasoning-delta') ||
			!active ||
			!eventSink
		) {
			return false;
		}

		active.deltaCounter += 1;
		const syntheticRow: AgentEventRow = {
			branchId,
			createdAt: event.at,
			eventType: event.type,
			id: `delta:${sessionId}:${active.lastBroadcastOrdinal}:${active.deltaCounter}`,
			ordinal: active.lastBroadcastOrdinal + active.deltaCounter * 1e-6,
			payload: {
				kind: 'message',
				...(event.parentToolCallId
					? { parentToolCallId: event.parentToolCallId }
					: {}),
				payload: event.payload,
				role: event.role,
			},
			stream: 'protocol',
			turnId: active.activeTurnId,
		};
		try {
			eventSink({
				event: syntheticRow,
				sessionId,
				workspaceId: active.row.workspaceId,
			});
		} catch (cause) {
			// Sink failures (renderer gone, IPC closed) must not break the
			// streaming path.
			console.warn('[agent-session] failed to broadcast streaming delta', {
				cause: cause instanceof Error ? cause.message : String(cause),
				sessionId,
			});
		}
		return true;
	};

	/**
	 * Applies a status change: patches the session row, and at a turn boundary
	 * drains the summary queue and retries the derived tab title.
	 * @param active - The live session, when it is still in the active map
	 * @param branchId - Branch the event belongs to
	 * @param database - Open database handle
	 * @param sessionId - Session the event belongs to
	 * @param status - The status the runtime reported
	 */
	const applyStatus = ({
		active,
		branchId,
		database,
		sessionId,
		status,
	}: {
		active: ActiveSession | undefined;
		branchId: string;
		database: DatabaseSync;
		sessionId: string;
		status: AgentSessionStatus;
	}): void => {
		updateAgentSession({ database, id: sessionId, patch: { status } });
		if (status !== 'idle') {
			return;
		}
		summaryQueue.queueSummaryAfterAgentResponse({ database, sessionId });
		if (active) {
			// Retry the derived title off the settled turn; self-gates so a tab
			// already titled (or named by the agent or the user) is never
			// re-touched. Covers resumed sessions and first-attempt failures.
			queueNaming({
				branchId,
				chatTabId: active.chatTabId,
				database,
				eventSink,
				initialPrompt: null,
				liveSession: active.agentRuntimeSession,
				sessionId,
				workspaceId: active.row.workspaceId,
			});
		}
	};

	/**
	 * Closes out a session the runtime shut down: stamps the row closed, drains
	 * the summary queue, settles the open turn, and drops the active entry.
	 *
	 * `activeTurnId` keeps pointing at the last turn once it has settled, so a
	 * shutdown that interrupted nothing — the workspace teardown closing an idle
	 * session — would otherwise restamp a finished turn as aborted.
	 * @param active - The live session, when it is still in the active map
	 * @param database - Open database handle
	 * @param reason - Why the runtime shut the session down
	 * @param sessionId - Session the event belongs to
	 */
	const applyShutdown = ({
		active,
		database,
		reason,
		sessionId,
	}: {
		active: ActiveSession | undefined;
		database: DatabaseSync;
		reason: AgentShutdownReason;
		sessionId: string;
	}): void => {
		const settledStatus = resolveSettledTurnStatus({
			database,
			reason,
			sessionId,
		});
		updateAgentSession({
			database,
			id: sessionId,
			patch: { closedAt: now().toISOString(), status: 'closed' },
		});
		summaryQueue.queueSummaryAfterAgentResponse({ database, sessionId });
		if (active?.activeTurnId) {
			updateTurn({
				database,
				id: active.activeTurnId,
				patch: {
					completedAt: now().toISOString(),
					status: settledStatus,
				},
			});
		}
		activeSessions.delete(sessionId);
	};

	const handle = ({
		branchId,
		database,
		event,
		sessionId,
	}: {
		branchId: string;
		database: DatabaseSync;
		event: AgentEvent;
		sessionId: string;
	}): void => {
		const active = activeSessions.get(sessionId);

		if (tryBroadcastDelta({ active, branchId, event, sessionId })) {
			return;
		}

		// The runtime's turnId (event.turnId) is an opaque adapter identifier and
		// is NOT a foreign key into agent_turns. We attach the active turn row's id
		// (created via createTurn) so callers can group events per turn; the raw
		// runtime turn id is preserved inside the payload.
		const persistedRow = persistRuntimeEvent({
			branchId,
			database,
			event,
			sessionId,
			turnId: active?.activeTurnId ?? null,
		});

		if (persistedRow && active) {
			active.lastBroadcastOrdinal = persistedRow.ordinal;
			active.deltaCounter = 0;
		}

		if (persistedRow && eventSink) {
			broadcastPersistedEvent({
				active,
				database,
				event: persistedRow,
				eventSink,
				sessionId,
			});
		}

		if (active && event.type === 'message' && event.role === 'agent') {
			// Mark a summary as pending but defer the actual write to the next
			// turn boundary (`status: 'idle'`) or shutdown — never mid-turn — so
			// `.context/` is not created while a scaffolder needs an empty root.
			activeSessions.set(sessionId, {
				...active,
				agentResponsePendingSummary: true,
			});
		}

		if (event.type === 'metadata' && event.metadata.sessionId) {
			updateAgentSession({
				database,
				id: sessionId,
				patch: { runtimeSessionId: event.metadata.sessionId },
			});
		}
		if (event.type === 'status') {
			applyStatus({
				active,
				branchId,
				database,
				sessionId,
				status: event.status,
			});
		}
		if (event.type === 'shutdown') {
			applyShutdown({ active, database, reason: event.reason, sessionId });
		}
	};

	return { handle };
}

/**
 * Decides how a runtime shutdown settles the session's open turn. Only a
 * shutdown that actually interrupted a running turn aborts it; one that reached
 * an idle session — the workspace teardown closing a chat nobody was using —
 * settles the turn it finds as completed, because that is what the turn did.
 * @param database - Open database handle
 * @param reason - Why the runtime shut the session down
 * @param sessionId - Session the shutdown belongs to
 * @returns The status to stamp on the turn
 */
function resolveSettledTurnStatus({
	database,
	reason,
	sessionId,
}: {
	database: DatabaseSync;
	reason: AgentShutdownReason;
	sessionId: string;
}): AgentTurnStatus {
	const interruptedARunningTurn =
		reason !== 'completed' && isTurnInFlight(database, sessionId);
	return interruptedARunningTurn ? 'aborted' : 'completed';
}

/**
 * Pushes a persisted event to the renderer, addressed to the workspace that
 * owns the session. Drops the event only when the session is unknown, and never
 * lets a sink failure (renderer gone, IPC closed) break persistence.
 *
 * The workspace falls back to the persisted row once the session has left the
 * active map: `stopSession` drops it as soon as the abort signal is sent, while
 * the runtime's `shutdown` only lands when the child exits. Without the
 * fallback that tail — the marker saying the user stopped the turn — is
 * persisted yet never broadcast, so it surfaces only on the next refetch.
 * @param active - Active session entry, absent once the session was dropped
 * @param database - Open session database
 * @param event - The persisted row to broadcast
 * @param eventSink - Sink that fans the event out to renderer windows
 * @param sessionId - Session the event belongs to
 */
function broadcastPersistedEvent({
	active,
	database,
	event,
	eventSink,
	sessionId,
}: {
	active: ActiveSession | undefined;
	database: DatabaseSync;
	event: AgentEventRow;
	eventSink: AgentSessionEventSink;
	sessionId: string;
}): void {
	const workspaceId =
		active?.row.workspaceId ??
		getAgentSessionById({ database, id: sessionId })?.workspaceId;
	if (!workspaceId) {
		return;
	}
	try {
		eventSink({ event, sessionId, workspaceId });
	} catch (cause) {
		// Sink failures (renderer gone, IPC closed) must not break persistence.
		console.warn('[agent-session] failed to broadcast persisted event', {
			cause: cause instanceof Error ? cause.message : String(cause),
			eventType: event.eventType,
			sessionId,
		});
	}
}
