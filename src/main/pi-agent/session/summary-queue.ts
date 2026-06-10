import type { DatabaseSync } from 'node:sqlite';
import { listEventsByBranch } from '../../storage/repositories/pi-event-repository.ts';
import { getPiSessionById } from '../../storage/repositories/pi-session-repository.ts';
import type { SessionSummaryWriter } from '../session-summary-writer.ts';
import type { ActiveSession, ActiveSessionMap } from './active-session.ts';
import { persistSummaryMetadata, toEventWire } from './session-snapshot.ts';

export interface SummaryQueueOptions {
	activeSessions: ActiveSessionMap;
	now: () => Date;
	sessionSummaryWriter: SessionSummaryWriter | undefined;
}

export interface SummaryQueue {
	queueSummaryAfterAgentResponse: (input: {
		database: DatabaseSync;
		sessionId: string;
	}) => void;
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
}: SummaryQueueOptions): SummaryQueue {
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
		if (!active.summaryWriteInFlight) {
			void drainSummaryQueue({ database, sessionId });
		}
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
			piSessionId: row.piSessionId,
			workspaceCwd: row.cwd,
		});
		persistSummaryMetadata({
			database,
			result,
			tabId: active.chatTabId,
		});
	};

	return { queueSummaryAfterAgentResponse };
}
