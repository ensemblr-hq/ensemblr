import type { DatabaseSync } from 'node:sqlite';
import { listEventsByBranch } from '../../storage/repositories/pi-event-repository.ts';
import { getPiSessionById } from '../../storage/repositories/pi-session-repository.ts';
import type { SessionSummaryWriter } from '../session-summary-writer.ts';
import type { ActiveSession, ActiveSessionMap } from './active-session.ts';
import { persistSummaryMetadata, toEventWire } from './session-snapshot.ts';

/** Public surface of the summary queue: schedule per-turn summaries and flush any owed summary on close. */
export interface SummaryQueue {
	queueSummaryAfterAgentResponse: (input: {
		database: DatabaseSync;
		sessionId: string;
	}) => void;
	/**
	 * Forces any owed summary to disk and resolves once it is written. Close
	 * paths must call this: after teardown no `idle`/`shutdown` event remains to
	 * drain the queue, so the final turn's summary would otherwise be lost.
	 */
	flushSummaryForSession: (input: {
		database: DatabaseSync;
		sessionId: string;
	}) => Promise<void>;
	/**
	 * Awaits every in-flight drain, including those for sessions already removed
	 * from the active map (e.g. a `stopSession` that backgrounded its flush).
	 * App shutdown calls this so a stopped session's final summary lands before
	 * the process exits.
	 */
	awaitInFlight: () => Promise<void>;
}

/**
 * Owns the queued/in-flight bookkeeping for summary writes. Serializes writes
 * per session so older LLM responses cannot overwrite newer ones, and only
 * starts a drain loop when no write is already in flight.
 */
export function createSummaryQueue({
	activeSessions,
	now,
	sessionSummaryWriter,
}: {
	activeSessions: ActiveSessionMap;
	now: () => Date;
	sessionSummaryWriter: SessionSummaryWriter | undefined;
}): SummaryQueue {
	/** In-flight drain promise per session, so close paths can await it. */
	const inFlightDrains = new Map<string, Promise<void>>();

	/**
	 * Starts the drain loop for a session, or returns the already-running one.
	 * Routing both the live trigger and the close-path flush through here keeps
	 * writes serialized (no concurrent drains) while making them await-able.
	 */
	const startDrain = ({
		database,
		sessionId,
	}: {
		database: DatabaseSync;
		sessionId: string;
	}): Promise<void> => {
		const existing = inFlightDrains.get(sessionId);
		if (existing) {
			return existing;
		}
		const drain = drainSummaryQueue({ database, sessionId }).finally(() => {
			inFlightDrains.delete(sessionId);
		});
		inFlightDrains.set(sessionId, drain);
		return drain;
	};

	/** Marks the latest agent turn for summary writing once the runtime is idle. */
	const queueSummaryAfterAgentResponse = ({
		database,
		sessionId,
	}: {
		database: DatabaseSync;
		sessionId: string;
	}): void => {
		const active = activeSessions.get(sessionId);
		if (!active?.agentResponsePendingSummary || !sessionSummaryWriter) {
			return;
		}
		const queued: ActiveSession = {
			...active,
			agentResponsePendingSummary: false,
			summaryQueued: true,
		};
		activeSessions.set(sessionId, queued);
		void startDrain({ database, sessionId });
	};

	/** Serializes live summary writes so older LLM responses cannot win races. */
	const drainSummaryQueue = async ({
		database,
		sessionId,
	}: {
		database: DatabaseSync;
		sessionId: string;
	}): Promise<void> => {
		for (;;) {
			const active = activeSessions.get(sessionId);
			if (!active?.summaryQueued || !sessionSummaryWriter) {
				return;
			}
			activeSessions.set(sessionId, {
				...active,
				summaryQueued: false,
				summaryWriteInFlight: true,
			});
			try {
				await writeSummaryForSession({ active, database });
			} catch (cause) {
				console.warn('[pi-session-lifecycle] writeSessionSummary failed.', {
					cause: cause instanceof Error ? cause.message : String(cause),
					sessionId,
				});
			}
			const latest = activeSessions.get(sessionId);
			if (!latest) {
				return;
			}
			if (!latest.summaryQueued) {
				activeSessions.set(sessionId, {
					...latest,
					summaryWriteInFlight: false,
				});
				return;
			}
		}
	};

	/** Writes the current persisted transcript to the tab's summary markdown. */
	const writeSummaryForSession = async ({
		active,
		database,
	}: {
		active: ActiveSession;
		database: DatabaseSync;
	}): Promise<void> => {
		if (!sessionSummaryWriter) {
			return;
		}
		const row = getPiSessionById({ database, id: active.row.id });
		if (!row) {
			return;
		}
		const events = listEventsByBranch({
			branchId: active.branch.id,
			database,
		}).map(toEventWire);
		const result = await sessionSummaryWriter.writeSessionSummary({
			branchId: active.branch.id,
			chatTabId: active.chatTabId,
			closedAt: row.closedAt ?? now().toISOString(),
			events,
			model: row.model,
			piSessionId: row.piSessionId,
			workspaceCwd: row.cwd,
		});
		persistSummaryMetadata({
			database,
			result,
			tabId: active.chatTabId,
		});
	};

	/**
	 * Forces the latest owed summary to disk and awaits completion. Promotes a
	 * pending flag to queued so the drain captures the final transcript; an
	 * already in-flight drain is reused (and re-loops for the newest state).
	 * No-ops when nothing is owed and no drain is running.
	 */
	const flushSummaryForSession = async ({
		database,
		sessionId,
	}: {
		database: DatabaseSync;
		sessionId: string;
	}): Promise<void> => {
		const active = activeSessions.get(sessionId);
		if (!active || !sessionSummaryWriter) {
			return;
		}
		if (active.agentResponsePendingSummary || active.summaryQueued) {
			activeSessions.set(sessionId, {
				...active,
				agentResponsePendingSummary: false,
				summaryQueued: true,
			});
		} else if (!inFlightDrains.has(sessionId)) {
			return;
		}
		await startDrain({ database, sessionId });
	};

	/** Awaits all currently in-flight drains, looping until the map settles. */
	const awaitInFlight = async (): Promise<void> => {
		while (inFlightDrains.size > 0) {
			await Promise.allSettled([...inFlightDrains.values()]);
		}
	};

	return {
		awaitInFlight,
		flushSummaryForSession,
		queueSummaryAfterAgentResponse,
	};
}
