import type {
	AgentError,
	AgentErrorCode,
	AgentEvent,
	AgentEventListener,
	AgentSessionId,
	AgentSessionMetadata,
	AgentSessionRequest,
	AgentSessionState,
	AgentSubmitAcknowledgement,
	AgentSubmitRequest,
	AgentSubscription,
} from './agent-types.ts';

/**
 * Inputs passed to an `AgentAdapter` when opening a session. The client owns
 * env normalization and metadata seeding; the adapter owns the translation from
 * the provider-neutral `request` into its runtime's own flags or options, and
 * writes the result back onto `metadata.args`/`metadata.command` before it emits
 * the first `metadata` event.
 */
export interface AgentAdapterCreateSessionInput {
	metadata: AgentSessionMetadata;
	request: AgentSessionRequest;
}

/**
 * Contract every agent runtime implements. `pi-agent/` drives `pi --mode rpc`;
 * `claude-agent/` drives Claude Code through the Agent SDK. Neither imports the
 * other — they are siblings over this contract, and the client dispatches on
 * `AgentSessionRequest.provider`.
 *
 * Adapter contract notes:
 *   - The returned `AgentAdapterSession.id` MUST equal `input.metadata.id`,
 *     which is the `agent_sessions.id` the request opened under. The client
 *     registers sessions by that id and surfaces it back to callers.
 *   - Listener fan-out in `subscribe` MUST isolate exceptions: one throwing
 *     listener must not prevent others from receiving the event.
 */
export interface AgentAdapter {
	/** Open a new session. Implementations may spawn a subprocess or drive an SDK. */
	createSession: (
		input: AgentAdapterCreateSessionInput,
	) => Promise<AgentAdapterSession>;
	/** Release shared resources held by the adapter (e.g., supervisor pools). */
	shutdown: () => Promise<void>;
}

/**
 * Per-session handle returned by `AgentAdapter.createSession`. The client wraps
 * this with input validation, metadata tracking, and lifecycle guards.
 */
export interface AgentAdapterSession {
	abort: (reason?: string) => Promise<void>;
	close: () => Promise<void>;
	getMetadata: () => AgentSessionMetadata;
	getState: () => Promise<AgentSessionState>;
	id: AgentSessionId;
	/** Sets the session's display name in the runtime, when it has one. */
	setSessionName: (name: string) => Promise<void>;
	subscribe: (listener: AgentEventListener) => AgentSubscription;
	submit: (request: AgentSubmitRequest) => Promise<AgentSubmitAcknowledgement>;
}

/**
 * Builds the `error` event emitter every adapter needs, so a Pi failure and a
 * Claude failure reach the timeline in the same shape rather than each runtime
 * inventing its own.
 * @param options - The session's event sink and clock.
 * @returns An emitter taking the error code, message, optional detail, and whether the session can continue.
 */
export function createAgentErrorEmitter({
	emit,
	now,
}: {
	emit: (event: AgentEvent) => void;
	now: () => Date;
}): (
	code: AgentErrorCode,
	message: string,
	detail?: string,
	recoverable?: boolean,
) => void {
	return (code, message, detail, recoverable = false) => {
		const error: AgentError = { code, detail, message, recoverable };
		emit({ at: now().toISOString(), error, type: 'error' });
	};
}
