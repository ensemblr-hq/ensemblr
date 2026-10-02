import type {
	ToolApprovalClosedBroadcast,
	ToolApprovalReply,
	ToolApprovalRequestedBroadcast,
} from '../../agent-tool-approval.ts';

/**
 * A decision plus the chat it was made in. The request broadcast fans out to
 * every window, so main verifies this against the pending request before it
 * settles anything: without the scope, a request id alone lets one renderer
 * answer a prompt that belongs to another chat's session.
 */
export interface ScopedToolApprovalReply extends ToolApprovalReply {
	agentSessionId: string;
}

/**
 * Per-tool approval IPC surface for Claude's `approval-required` mode. Two
 * broadcasts keep the card in step with the blocked tool call, and one invoke
 * carries the user's decision back to the process holding it open.
 */
export interface AgentToolApprovalApi {
	/**
	 * Subscribes to tool calls waiting on the user (a Claude session is blocked on
	 * the answer). Returns an unsubscribe function. The renderer shows each one in
	 * the chat tab bound to the payload's agent session.
	 */
	onAgentToolApprovalRequested: (
		listener: (payload: ToolApprovalRequestedBroadcast) => void,
	) => () => void;
	/**
	 * Subscribes to prompt withdrawals (the turn was interrupted, the session
	 * stopped, or the app is quitting). Returns an unsubscribe function.
	 */
	onAgentToolApprovalClosed: (
		listener: (payload: ToolApprovalClosedBroadcast) => void,
	) => () => void;
	/**
	 * Answers a pending prompt, unblocking the tool call that raised it. The
	 * answer names the agent session it was made in; main drops it when that does
	 * not match the session the request id belongs to.
	 */
	agentToolApprovalAnswered: (reply: ScopedToolApprovalReply) => Promise<void>;
}
