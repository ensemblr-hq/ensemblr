import type {
	AgentSessionBranchRow,
	AgentSessionRow,
} from '../../storage/repositories';
import type { AgentSession } from '../agent-client.ts';
import type { AgentSubscription } from '../agent-types.ts';

/** Live binding between a persisted agent session row and a runtime AgentSession. */
export interface ActiveSession {
	activeTurnId: string | null;
	agentResponsePendingSummary: boolean;
	branch: AgentSessionBranchRow;
	chatTabId: string;
	agentRuntimeSession: AgentSession;
	row: AgentSessionRow;
	summaryQueued: boolean;
	subscription: AgentSubscription;
	/**
	 * Largest ordinal we've broadcast so far for this session's branch. Updated
	 * from every successful `persistRuntimeEvent` and used as the seed when we
	 * synthesize ephemeral delta rows for live streaming.
	 */
	lastBroadcastOrdinal: number;
	/** Monotonic counter for fractional delta ordinals between persisted events. */
	deltaCounter: number;
}

/** Mutable map keyed by persisted agent session id. */
export type ActiveSessionMap = Map<string, ActiveSession>;
