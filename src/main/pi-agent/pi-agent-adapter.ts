import type {
	PiAgentEventListener,
	PiAgentSessionId,
	PiAgentSessionMetadata,
	PiAgentSessionState,
	PiAgentSubmitAcknowledgement,
	PiAgentSubmitRequest,
	PiAgentSubscription,
} from './pi-agent-types.ts';

/**
 * Inputs passed to a `PiAgentAdapter` when opening a session. The client owns
 * argument resolution, env normalization, ID generation, and metadata seeding,
 * so adapters can stay focused on launching the underlying runtime. Spawn
 * fields (`command`, `args`, `cwd`, `env`) live on `metadata`.
 */
export interface PiAgentAdapterCreateSessionInput {
	metadata: PiAgentSessionMetadata;
}

/**
 * Adapter contract for a concrete Pi runtime implementation. CLI RPC will be
 * the first adapter (THE-127); the same contract is intentionally compatible
 * with a future SDK sidecar fallback.
 *
 * Adapter contract notes:
 *   - The returned `PiAgentAdapterSession.id` MUST equal `input.metadata.id`.
 *     The client registers sessions by that id and surfaces it back to callers.
 *   - Listener fan-out in `subscribe` MUST isolate exceptions: one throwing
 *     listener must not prevent others from receiving the event.
 */
export interface PiAgentAdapter {
	/** Open a new session. Implementations may spawn a subprocess or open a sidecar. */
	createSession: (
		input: PiAgentAdapterCreateSessionInput,
	) => Promise<PiAgentAdapterSession>;
	/** Release shared resources held by the adapter (e.g., supervisor pools). */
	shutdown: () => Promise<void>;
}

/**
 * Per-session handle returned by `PiAgentAdapter.createSession`. The client
 * wraps this with input validation, metadata tracking, and lifecycle guards.
 */
export interface PiAgentAdapterSession {
	abort: (reason?: string) => Promise<void>;
	close: () => Promise<void>;
	getMetadata: () => PiAgentSessionMetadata;
	getState: () => Promise<PiAgentSessionState>;
	id: PiAgentSessionId;
	subscribe: (listener: PiAgentEventListener) => PiAgentSubscription;
	submit: (
		request: PiAgentSubmitRequest,
	) => Promise<PiAgentSubmitAcknowledgement>;
}
