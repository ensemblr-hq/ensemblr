import type {
	PiSessionBranchRow,
	PiSessionRow,
} from '../../storage/repositories/pi-session-repository.ts';
import type { PiAgentSession } from '../pi-agent-client.ts';
import type { PiAgentSubscription } from '../pi-agent-types.ts';

/** Live binding between a persisted Pi session row and a runtime PiAgentSession. */
export interface ActiveSession {
	activeTurnId: string | null;
	agentResponsePendingSummary: boolean;
	branch: PiSessionBranchRow;
	chatTabId: string;
	piRuntimeSession: PiAgentSession;
	row: PiSessionRow;
	summaryQueued: boolean;
	summaryWriteInFlight: boolean;
	subscription: PiAgentSubscription;
	/**
	 * Largest ordinal we've broadcast so far for this session's branch. Updated
	 * from every successful `persistRuntimeEvent` and used as the seed when we
	 * synthesize ephemeral delta rows for live streaming.
	 */
	lastBroadcastOrdinal: number;
	/** Monotonic counter for fractional delta ordinals between persisted events. */
	deltaCounter: number;
}

/** Mutable map keyed by persisted Pi session id. */
export type ActiveSessionMap = Map<string, ActiveSession>;
