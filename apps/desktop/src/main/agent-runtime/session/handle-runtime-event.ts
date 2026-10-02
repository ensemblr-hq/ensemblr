import type { DatabaseSync } from 'node:sqlite';
import {
	createAgentActivityState,
	reduceAgentActivity,
} from '../../../shared/agent-activity.ts';
import type { AgentEventRow } from '../../storage/repositories';
import { getMaxOrdinalForBranch } from '../../storage/repositories/agent-event-repository.ts';
import {
	type AgentTurnStatus,
	getAgentSessionById,
	updateAgentSession,
} from '../../storage/repositories/agent-session-repository.ts';
import type { AgentSession } from '../agent-client.ts';
import { eventPayload } from '../agent-session-persistence.ts';
import type { AgentSessionEventSink } from '../agent-session-types.ts';
import type {
	AgentEvent,
	AgentSessionStatus,
	AgentShutdownReason,
} from '../agent-types.ts';
import { isTimelineAgentEvent } from '../event-admission.ts';
import type { SessionNamingInput } from '../naming/session-naming.ts';
import {
	type ActiveSession,
	type ActiveSessionMap,
	isTurnInFlight,
} from './active-session.ts';
import {
	createDeltaCoalescer,
	type DeltaRun,
	type DeltaSlot,
} from './delta-coalescer.ts';
import { isValidContextUsage } from './session-activity-snapshot.ts';
import type { SummaryQueue } from './summary-queue.ts';
import type { TurnBoundaries } from './turn-boundaries.ts';

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
	/** Settles the active turn at idle and reopens it when the runtime resumes it. */
	turnBoundaries: TurnBoundaries;
}

/** Handler that persists a normalized runtime event and schedules summary refreshes. */
interface RuntimeEventHandler {
	handle: (input: {
		branchId: string;
		database: DatabaseSync;
		event: AgentEvent;
		runtimeSession?: AgentSession;
		sessionId: string;
	}) => void;
}

/**
 * Persists one normalized runtime event and schedules summary refreshes.
 *
 * Two events never reach persistence: a streaming delta, which is broadcast
 * ephemerally and superseded by the authoritative `message_end`, and an event
 * the timeline cannot render at all (see {@link isTimelineAgentEvent}).
 *
 * Adjacent deltas of one stream are coalesced into a single broadcast per flush
 * window (see {@link createDeltaCoalescer}). The open run is flushed ahead of
 * every event that is persisted, so a run always reaches the sink before the
 * event that followed it and its ephemeral ordinal sorts below that event's.
 *
 * Side-effect ordering is load-bearing: delta flush → persistence write →
 * snapshot/broadcast → agent-end fan-out (sets `agentResponsePendingSummary`) →
 * status/shutdown patches → summary queue check. Reordering risks race
 * regressions where a summary write fires before the latest message_end is
 * persisted.
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
	turnBoundaries,
}: RuntimeEventHandlerOptions): RuntimeEventHandler {
	/**
	 * Broadcasts one coalesced run of live message deltas as an ephemeral row
	 * whose fractional ordinal sits between the last persisted event and the next
	 * one, skipping the `BEGIN IMMEDIATE` write per token. The authoritative
	 * `message_end` still persists the full text so a refetch rehydrates
	 * correctly.
	 * @param run - The run to broadcast, carrying the ordinal reserved when it opened
	 */
	const broadcastDeltaRun = (run: DeltaRun): void => {
		const syntheticRow: AgentEventRow = {
			branchId: run.branchId,
			createdAt: run.at,
			eventType: 'message',
			id: run.slot.id,
			ordinal: run.slot.ordinal,
			payload: {
				kind: 'message',
				...(run.parentToolCallId
					? { parentToolCallId: run.parentToolCallId }
					: {}),
				payload: { kind: run.kind, text: run.text },
				role: run.role,
			},
			stream: 'protocol',
			turnId: run.turnId,
		};
		try {
			eventSink?.({
				event: syntheticRow,
				sessionId: run.sessionId,
				workspaceId: run.workspaceId,
			});
		} catch (cause) {
			// Sink failures (renderer gone, IPC closed) must not break the
			// streaming path.
			console.warn('[agent-session] failed to broadcast streaming delta', {
				cause: cause instanceof Error ? cause.message : String(cause),
				sessionId: run.sessionId,
			});
		}
	};

	const deltas = createDeltaCoalescer({ emit: broadcastDeltaRun });

	/**
	 * Fast path for live message deltas: folds the delta into its session's open
	 * run, which is broadcast once its flush window closes or a persisted event
	 * arrives, instead of broadcasting every token.
	 * @param active - The live session, when it is still in the active map
	 * @param branchId - Branch the event belongs to
	 * @param database - Open database handle, read when a run opens
	 * @param event - The normalized runtime event
	 * @param sessionId - Session the event belongs to
	 * @returns True when the event was a delta this took in, false to fall through to persistence
	 */
	const tryCoalesceDelta = ({
		active,
		branchId,
		database,
		event,
		sessionId,
	}: {
		active: ActiveSession | undefined;
		branchId: string;
		database: DatabaseSync;
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

		deltas.push(
			{
				at: event.at,
				branchId,
				kind: event.payload.kind,
				...(event.parentToolCallId
					? { parentToolCallId: event.parentToolCallId }
					: {}),
				role: event.role,
				sessionId,
				text: event.payload.text,
				turnId: active.activeTurnId,
				workspaceId: active.row.workspaceId,
			},
			() => reserveDeltaSlot({ active, branchId, database, sessionId }),
		);
		return true;
	};

	/**
	 * Applies a status change: patches the session row, and at a turn boundary
	 * settles the active turn, drains the summary queue, and retries the derived
	 * tab title.
	 *
	 * `idle` ends the active turn and locks its diff. A later `streaming` on the
	 * same turn reopens it: Claude reports `idle` at every SDK result and streams
	 * again when it drains a queued follow-up or carries on by itself, so the
	 * settle it just made was premature. A turn a new input superseded is never
	 * the active one by then, and an aborted or errored turn stays settled.
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
		if (status === 'streaming' && active) {
			turnBoundaries.reopenSettledTurn({ active, database });
		}
		if (status !== 'idle') {
			return;
		}
		if (active) {
			turnBoundaries.settleOpenTurn({
				active,
				database,
				status: 'completed',
			});
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
	 * `activeTurnId` keeps pointing at the last turn once it has settled, so only
	 * a turn still open is stamped — a shutdown that interrupted nothing, such as
	 * the workspace teardown closing an idle session, must neither restamp a
	 * finished turn as aborted nor move the instant its diff locked.
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
		if (active) {
			turnBoundaries.settleOpenTurn({
				active,
				database,
				status: settledStatus,
			});
		}
		activeSessions.delete(sessionId);
	};

	const handle = ({
		branchId,
		database,
		event,
		runtimeSession,
		sessionId,
	}: {
		branchId: string;
		database: DatabaseSync;
		event: AgentEvent;
		runtimeSession?: AgentSession;
		sessionId: string;
	}): void => {
		const activeCandidate = activeSessions.get(sessionId);
		if (
			runtimeSession &&
			activeCandidate &&
			activeCandidate.agentRuntimeSession !== runtimeSession
		) {
			return;
		}
		const active = activeCandidate;

		if (tryCoalesceDelta({ active, branchId, database, event, sessionId })) {
			return;
		}

		if (!isTimelineAgentEvent(event)) {
			return;
		}

		deltas.flush(sessionId);

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

		if (active) {
			const activity = reduceAgentActivity(
				active.activity ?? createAgentActivityState(),
				eventPayload(event),
			);
			const projected =
				event.type === 'context-usage' && isValidContextUsage(event.usage)
					? { ...active, activity, contextUsage: event.usage }
					: { ...active, activity };
			activeSessions.set(sessionId, projected);
		}
		const projectedActive = activeSessions.get(sessionId);

		if (persistedRow && eventSink) {
			broadcastPersistedEvent({
				active: projectedActive,
				database,
				event: persistedRow,
				eventSink,
				sessionId,
			});
		}

		if (projectedActive && event.type === 'message' && event.role === 'agent') {
			// Mark a summary as pending but defer the actual write to the next
			// turn boundary (`status: 'idle'`) or shutdown — never mid-turn — so
			// `.context/` is not created while a scaffolder needs an empty root.
			activeSessions.set(sessionId, {
				...projectedActive,
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
				active: activeSessions.get(sessionId),
				branchId,
				database,
				sessionId,
				status: event.status,
			});
		}
		if (event.type === 'shutdown') {
			applyShutdown({
				active: activeSessions.get(sessionId),
				database,
				reason: event.reason,
				sessionId,
			});
		}
	};

	return { handle };
}

/**
 * Reserves the ordinal a delta run will broadcast under: a fractional step past
 * the newest row of the branch, so the run sorts after everything already sent
 * and before whatever is persisted next. Called once per run, when it opens.
 *
 * The newest row is read from storage rather than remembered from the last
 * event this handler persisted, because rows also land from outside the runtime
 * stream — a derived or chosen tab title, a submitted plan, a workspace rename —
 * and a remembered ordinal would leave the run sorting below them. That is one
 * indexed read per run, never one per token.
 * @param active - The live session whose ordinal space the run joins
 * @param branchId - Branch the run belongs to
 * @param database - Open database handle
 * @param sessionId - Session the run belongs to
 * @returns The run's ephemeral row id and ordinal
 */
function reserveDeltaSlot({
	active,
	branchId,
	database,
	sessionId,
}: {
	active: ActiveSession;
	branchId: string;
	database: DatabaseSync;
	sessionId: string;
}): DeltaSlot {
	const newest = readNewestOrdinal({
		branchId,
		database,
		fallback: active.lastBroadcastOrdinal,
		sessionId,
	});
	if (newest > active.lastBroadcastOrdinal) {
		active.lastBroadcastOrdinal = newest;
		active.deltaCounter = 0;
	}
	active.deltaCounter += 1;
	return {
		id: `delta:${sessionId}:${active.lastBroadcastOrdinal}:${active.deltaCounter}`,
		ordinal: active.lastBroadcastOrdinal + active.deltaCounter * 1e-6,
	};
}

/**
 * Reads the newest stored ordinal of a branch. A failed read falls back to the
 * ordinal already known, so it costs a possibly stale sort position rather than
 * the streaming path, matching how a failed event write is handled.
 * @param branchId - Branch to read
 * @param database - Open database handle
 * @param fallback - Ordinal to use when storage cannot answer
 * @param sessionId - Session the read is for, named in the warning
 * @returns The newest stored ordinal, or the fallback
 */
function readNewestOrdinal({
	branchId,
	database,
	fallback,
	sessionId,
}: {
	branchId: string;
	database: DatabaseSync;
	fallback: number;
	sessionId: string;
}): number {
	try {
		return getMaxOrdinalForBranch({ branchId, database });
	} catch (cause) {
		console.warn('[agent-session] failed to read the newest event ordinal', {
			cause: cause instanceof Error ? cause.message : String(cause),
			sessionId,
		});
		return fallback;
	}
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
