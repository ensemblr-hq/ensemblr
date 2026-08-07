import type {
	AgentEventRow,
	AgentSessionRow,
	ChatTabRow,
} from '../storage/repositories';

/** Snapshot of a persisted agent session's state, including its open chat tabs and runtime status. */
export interface AgentSessionSnapshot {
	branchId: string;
	closedAt: string | null;
	createdAt: string;
	cwd: string;
	id: string;
	label: string | null;
	model: string | null;
	openedTabs: readonly ChatTabRow[];
	provider: AgentSessionRow['provider'];
	runtimeOpen: boolean;
	/**
	 * Mirror of `agent_sessions.runtime_session_id`: the session id the agent
	 * runtime uses for the process Ensemblr manages (Pi's `--session-id`). Not a
	 * foreign key — this session's own Ensemblr id is `id`, and a chat tab's
	 * `agentSessionId` is the reference to that.
	 */
	runtimeSessionId: string | null;
	status: AgentSessionRow['status'];
	thinkingLevel: string | null;
	updatedAt: string;
	workspaceId: string;
}

/** Side-channel called once per persisted event so callers can broadcast it. */
export type AgentSessionEventSink = (input: {
	event: AgentEventRow;
	sessionId: string;
	workspaceId: string;
}) => void;
