/** Canonical session status union; the main-process repository aliases this. */
export type PiSessionStatusWire =
	| 'idle'
	| 'starting'
	| 'streaming'
	| 'closed'
	| 'errored';

/** Which stream a persisted Pi event came from: the structured protocol channel or raw stderr. */
export type PiEventStreamWire = 'protocol' | 'stderr';

/** Error shape carried across the wire on persisted error events. */
export interface PiWireError {
	code?: string;
	detail?: string | null;
	message: string;
	recoverable?: boolean;
}

/** Metadata payload carried on persisted metadata events. */
export interface PiWireMetadata {
	chatTitle?: string;
	model?: { displayName?: string; id: string; provider: string } | null;
	sessionId?: string | null;
	status?: PiSessionStatusWire;
	/** Set when an auto branch-naming rename landed; cues a workspace-list refresh. */
	workspaceRenamed?: boolean;
}

/**
 * Canonical message-part shape carried across the wire and reused inside the
 * main-process pi-agent boundary as `PiAgentMessagePart`. Keeping one definition
 * means a new variant added here is enforced everywhere by the type system —
 * no silent drift between main and renderer.
 */
export type PiWireMessagePart =
	| { kind: 'text'; text: string }
	| { kind: 'reasoning'; text: string }
	| { kind: 'tool-call'; input: unknown; name: string; toolCallId: string }
	| {
			kind: 'tool-result';
			isError: boolean;
			output: unknown;
			toolCallId: string;
	  };

/**
 * Canonical message-payload union on the wire. Reused inside the main-process
 * pi-agent boundary as `PiAgentMessagePayload` so exhaustiveness checks fail
 * on the producer side whenever a new variant is added.
 *
 * `text-delta` / `reasoning-delta` carry incremental chunks emitted by the Pi
 * runtime's `message_update` frame. They render as streaming-state parts on
 * the timeline; a subsequent `message` envelope for the same turn replaces
 * them with the authoritative final text.
 */
export type PiWireMessagePayload =
	| { kind: 'text'; text: string }
	| { kind: 'reasoning'; text: string }
	| { kind: 'text-delta'; text: string }
	| { kind: 'reasoning-delta'; text: string }
	| { input: unknown; kind: 'tool-call'; name: string; toolCallId: string }
	| {
			isError: boolean;
			kind: 'tool-result';
			output: unknown;
			toolCallId: string;
	  }
	| {
			kind: 'message';
			parts: readonly PiWireMessagePart[];
			role: 'assistant' | 'user';
	  }
	| { kind: 'prompt'; prompt: string }
	| { kind: 'unknown'; frameType: string; raw: unknown };

/** Context-window usage snapshot for a session. */
export interface PiContextUsageWire {
	contextWindow: number;
	percent: number | null;
	tokens: number | null;
}

/**
 * Tagged union persisted into `pi_session_events.payload_json` and replayed on
 * the renderer. Each variant maps 1:1 to a `PiAgentEvent` discriminant; the
 * envelope shape is stable so the renderer can match on `envelope.kind`
 * without sniffing raw Pi frames.
 */
export type PiPersistedEnvelope =
	| { kind: 'context-usage'; usage: PiContextUsageWire }
	| { kind: 'error'; error: PiWireError }
	| {
			kind: 'message';
			payload: PiWireMessagePayload;
			role: 'agent' | 'tool' | 'user';
	  }
	| { kind: 'metadata'; metadata: PiWireMetadata }
	| {
			kind: 'status';
			previous: PiSessionStatusWire;
			status: PiSessionStatusWire;
	  }
	| { kind: 'shutdown'; reason: string };
