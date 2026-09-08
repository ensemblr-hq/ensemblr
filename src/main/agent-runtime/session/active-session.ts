import type { DatabaseSync } from 'node:sqlite';

import type {
	AgentSessionBranchRow,
	AgentSessionRow,
} from '../../storage/repositories';
import { getAgentSessionById } from '../../storage/repositories/agent-session-repository.ts';
import type { AgentSession } from '../agent-client.ts';
import type { AgentContextUsage, AgentSubscription } from '../agent-types.ts';

/** Live binding between a persisted agent session row and a runtime AgentSession. */
export interface ActiveSession {
	activeTurnId: string | null;
	agentResponsePendingSummary: boolean;
	branch: AgentSessionBranchRow;
	chatTabId: string;
	/** External roots actually installed in this runtime, not merely selected in the composer. */
	linkedDirectories?: readonly string[];
	agentRuntimeSession: AgentSession;
	row: AgentSessionRow;
	/**
	 * Newest `context-usage` reading the runtime reported, or null before it has
	 * reported one. Held here rather than read back out of the persisted events
	 * because the agent-control wait loop polls it per target per tick, and the
	 * newest reading can sit hundreds of events back in a tool-heavy turn. It
	 * dies with the entry, which is correct: usage is a property of the running
	 * session rather than of the transcript it leaves behind.
	 */
	contextUsage: AgentContextUsage | null;
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

/**
 * Reads whether a session has a turn running right now.
 *
 * The persisted row is the only provider-neutral answer. `submitPrompt` stamps
 * it `streaming` before the runtime is reached and both adapters report `idle`
 * at the turn boundary, whereas `ActiveSession.activeTurnId` keeps pointing at
 * the last turn forever and adapter metadata tracks the transition on Pi only.
 * @param database - Open session database
 * @param sessionId - Session to read
 * @returns True while a turn is in flight
 */
export function isTurnInFlight(
	database: DatabaseSync,
	sessionId: string,
): boolean {
	return (
		getAgentSessionById({ database, id: sessionId })?.status === 'streaming'
	);
}
