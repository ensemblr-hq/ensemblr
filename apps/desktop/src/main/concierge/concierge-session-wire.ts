/**
 * The wire shapes the Concierge session service hands the renderer, plus the two
 * error narrowings its callers branch on. Split out from the service so the
 * projections stay readable next to each other rather than buried among the
 * runtime lifecycle they feed.
 */
import type {
	ConciergeSessionEventWire,
	ConciergeSessionSnapshotWire,
} from '../../shared/ipc/contracts/concierge.ts';
import { AgentClientError } from '../agent-runtime/agent-client.ts';
import type {
	ConciergeEventRow,
	ConciergeSessionRow,
} from '../storage/repositories/concierge-session-repository.ts';

/**
 * Projects a session row onto its renderer-facing snapshot.
 * @param row - Persisted session row.
 * @param runtimeOpen - Whether a runtime child is currently attached.
 * @returns The wire snapshot.
 */
export function toSnapshot(
	row: ConciergeSessionRow,
	runtimeOpen: boolean,
): ConciergeSessionSnapshotWire {
	return {
		closedAt: row.closedAt,
		createdAt: row.createdAt,
		cwd: row.cwd,
		id: row.id,
		lastError: row.lastError,
		model: row.model,
		provider: row.provider,
		runtimeOpen,
		status: row.status,
		thinkingLevel: row.thinkingLevel,
		title: row.title,
		updatedAt: row.updatedAt,
	};
}

/**
 * Projects a persisted event row onto its wire shape.
 * @param row - Persisted event row.
 * @returns The wire event.
 */
export function toEventWire(row: ConciergeEventRow): ConciergeSessionEventWire {
	return {
		createdAt: row.createdAt,
		eventType: row.eventType,
		id: row.id,
		ordinal: row.ordinal,
		payload: row.payload,
		sessionId: row.sessionId,
		stream: row.stream,
	};
}

/**
 * Coerces a thrown value into a message safe to persist and show.
 * @param error - Thrown value.
 * @returns A human-readable message.
 */
export function toMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Reports whether a failure means the runtime child behind the session is gone,
 * as opposed to a turn the live child refused.
 * @param error - Thrown value from a runtime call.
 * @returns True when the session is closed and only a replacement can serve it.
 */
export function isSessionClosedFailure(error: unknown): boolean {
	return error instanceof AgentClientError && error.code === 'session-closed';
}
