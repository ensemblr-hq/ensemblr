import type { DatabaseSync } from 'node:sqlite';
import type { PiEventRow } from '../../storage/repositories/pi-event-repository.ts';
import {
	updatePiSession,
	updateTurn,
} from '../../storage/repositories/pi-session-repository.ts';
import type { PiAgentEvent } from '../pi-agent-types.ts';
import type { PiSessionEventSink } from '../pi-session-types.ts';
import type { ActiveSessionMap } from './active-session.ts';
import type { SummaryQueue } from './summary-queue.ts';

/** Lifecycle calls this to mirror runtime events into `pi_session_events`. */
export type PersistRuntimeEventPort = (input: {
	branchId: string;
	database: DatabaseSync;
	event: PiAgentEvent;
	sessionId: string;
	turnId: string | null;
}) => PiEventRow | null;

/** Dependencies for {@link createRuntimeEventHandler}. */
export interface RuntimeEventHandlerOptions {
	activeSessions: ActiveSessionMap;
	eventSink: PiSessionEventSink | undefined;
	now: () => Date;
	persistRuntimeEvent: PersistRuntimeEventPort;
	summaryQueue: SummaryQueue;
}

/** Handler that persists a normalized runtime event and schedules summary refreshes. */
export interface RuntimeEventHandler {
	handle: (input: {
		branchId: string;
		database: DatabaseSync;
		event: PiAgentEvent;
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
	summaryQueue,
}: RuntimeEventHandlerOptions): RuntimeEventHandler {
	const handle = ({
		branchId,
		database,
		event,
		sessionId,
	}: {
		branchId: string;
		database: DatabaseSync;
		event: PiAgentEvent;
		sessionId: string;
	}): void => {
		const active = activeSessions.get(sessionId);

		// Fast path: live message deltas bypass SQLite. We synthesize an
		// ephemeral PiEventRow with a fractional ordinal between the last
		// persisted event and the next one, broadcast directly, and skip the
		// `BEGIN IMMEDIATE` write per token. The authoritative `message_end`
		// still persists with the full text so refetch rehydrates correctly.
		if (
			event.type === 'message' &&
			(event.payload.kind === 'text-delta' ||
				event.payload.kind === 'reasoning-delta') &&
			active &&
			eventSink
		) {
			active.deltaCounter += 1;
			const syntheticRow: PiEventRow = {
				branchId,
				createdAt: event.at,
				eventType: event.type,
				id: `delta:${sessionId}:${active.lastBroadcastOrdinal}:${active.deltaCounter}`,
				ordinal: active.lastBroadcastOrdinal + active.deltaCounter * 1e-6,
				payload: { kind: 'message', payload: event.payload, role: event.role },
				stream: 'protocol',
				turnId: active.activeTurnId,
			};
			try {
				eventSink({
					event: syntheticRow,
					sessionId,
					workspaceId: active.row.workspaceId,
				});
			} catch {
				// Sink failures (renderer gone, IPC closed) must not break the
				// streaming path.
			}
			return;
		}

		// The runtime's turnId (event.turnId) is an opaque adapter identifier and
		// is NOT a foreign key into pi_turns. We attach the active turn row's id
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

		if (persistedRow && eventSink && active) {
			try {
				eventSink({
					event: persistedRow,
					sessionId,
					workspaceId: active.row.workspaceId,
				});
			} catch {
				// Sink failures (renderer gone, IPC closed) must not break persistence.
			}
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
			updatePiSession({
				database,
				id: sessionId,
				patch: { piSessionId: event.metadata.sessionId },
			});
		}
		if (event.type === 'status') {
			updatePiSession({
				database,
				id: sessionId,
				patch: { status: event.status },
			});
			if (event.status === 'idle') {
				summaryQueue.queueSummaryAfterAgentResponse({ database, sessionId });
			}
		}
		if (event.type === 'shutdown') {
			updatePiSession({
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
						status: event.reason === 'completed' ? 'completed' : 'aborted',
					},
				});
			}
			activeSessions.delete(sessionId);
		}
	};

	return { handle };
}
