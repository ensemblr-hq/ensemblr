import type { AgentFailureClass } from '../../agent-failure.ts';

/** Canonical session status union; the main-process repository aliases this. */
export type AgentSessionStatusWire =
	| 'idle'
	| 'starting'
	| 'streaming'
	| 'closed'
	| 'errored';

/** Which stream a persisted agent event came from: the structured protocol channel or raw stderr. */
export type AgentEventStreamWire = 'protocol' | 'stderr';

/**
 * Error shape carried across the wire on persisted error events.
 *
 * `code` is the transport-level origin the agent client raised; `failureClass`
 * is the locale-neutral taxonomy the renderer keys designed copy and recovery
 * actions off, tagged by main when the event is persisted. It is optional
 * because rows written before the taxonomy shipped carry none — the renderer
 * re-classifies those on read.
 *
 * `resetsAt` is the ISO instant a self-clearing failure lifts, carried only when
 * the runtime reported one structurally rather than in prose.
 */
export interface AgentWireError {
	code?: string;
	detail?: string | null;
	failureClass?: AgentFailureClass;
	message: string;
	recoverable?: boolean;
	resetsAt?: string | null;
}

/** Metadata payload carried on persisted metadata events. */
export interface AgentWireMetadata {
	chatTitle?: string;
	model?: { displayName?: string; id: string; provider: string } | null;
	sessionId?: string | null;
	status?: AgentSessionStatusWire;
	/** Set when an auto branch-naming rename landed; cues a workspace-list refresh. */
	workspaceRenamed?: boolean;
}

/**
 * Canonical message-part shape carried across the wire and reused inside the
 * main-process agent-runtime boundary as `AgentMessagePart`. Keeping one
 * definition means a new variant added here is enforced everywhere by the type
 * system — no silent drift between main and renderer.
 */
export type AgentWireMessagePart =
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
 * agent-runtime boundary as `AgentMessagePayload` so exhaustiveness checks fail
 * on the producer side whenever a new variant is added.
 *
 * `text-delta` / `reasoning-delta` carry incremental chunks emitted by an agent
 * runtime as a turn streams. They render as streaming-state parts on the
 * timeline; a subsequent `message` envelope for the same turn replaces them
 * with the authoritative final text.
 *
 * `custom` carries a message an extension injected into the conversation. It is
 * context the agent reads, not prose it wrote, so it is kept apart from `text`
 * rather than folded into it.
 */
export type AgentWireMessagePayload =
	| { kind: 'text'; text: string }
	| {
			/** Extension-chosen tag, e.g. `context7_docs`; identifies the injector. */
			customType: string;
			/** The injector's own visibility hint; false means background context. */
			display: boolean;
			kind: 'custom';
			text: string;
	  }
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
			parts: readonly AgentWireMessagePart[];
			role: 'assistant' | 'user';
	  }
	| { kind: 'prompt'; prompt: string }
	| { kind: 'unknown'; frameType: string; raw: unknown };

/** Context-window usage snapshot for a session. */
export interface AgentContextUsageWire {
	contextWindow: number;
	percent: number | null;
	tokens: number | null;
}

/**
 * One plan rate-limit window. `id` is the runtime's own window key — `five_hour`
 * and `seven_day` are the ones every subscription reports; per-model buckets
 * arrive with a server-supplied `displayName` instead of a name the app knows.
 */
export interface AgentPlanLimitWindowWire {
	displayName: string | null;
	id: string;
	/** ISO 8601 instant the window resets, or null when the runtime reported none. */
	resetsAt: string | null;
	/** Share of the window already consumed, 0-100, or null when unreported. */
	utilization: number | null;
}

/**
 * Whether the account may still spend against a window. `allowed-warning` is the
 * runtime's own "close to the ceiling" signal, not a threshold the app derives.
 */
export type AgentPlanLimitStatusWire =
	| 'allowed'
	| 'allowed-warning'
	| 'rejected';

/**
 * Single-window rate-limit snapshot a runtime pushes as utilization moves. One
 * event describes one window, so a session reports several over its life.
 */
export interface AgentPlanLimitWire {
	status: AgentPlanLimitStatusWire;
	window: AgentPlanLimitWindowWire;
}

/** Token and cost totals one model accumulated within a session. */
export interface AgentModelCostWire {
	cacheCreationInputTokens: number;
	cacheReadInputTokens: number;
	costUsd: number;
	inputTokens: number;
	model: string;
	outputTokens: number;
}

/**
 * Running cost a session has accumulated, as its runtime estimates it. Cumulative
 * from the session's own start: a resumed session begins again at zero, so this is
 * what this conversation spent rather than what the chat has cost over its life.
 */
export interface AgentSessionCostWire {
	models: readonly AgentModelCostWire[];
	totalCostUsd: number;
}

/**
 * Tagged union persisted into `agent_session_events.payload_json` and replayed
 * on the renderer. Each variant maps 1:1 to an `AgentEvent` discriminant; the
 * envelope shape is stable so the renderer can match on `envelope.kind` without
 * sniffing a runtime's raw frames.
 */
export type AgentPersistedEnvelope =
	| { kind: 'context-usage'; usage: AgentContextUsageWire }
	| { kind: 'error'; error: AgentWireError }
	| {
			kind: 'message';
			/**
			 * Tool call whose subagent produced this message, absent on the main
			 * thread. Claude Code forwards a `Task`'s messages flat at top level
			 * tagged with the call that spawned them, so this is what lets the
			 * timeline re-nest them under that call's card. Runtimes without
			 * subagents never set it and rows persisted before it existed omit it —
			 * absent always means main thread.
			 */
			parentToolCallId?: string;
			payload: AgentWireMessagePayload;
			role: 'agent' | 'tool' | 'user';
	  }
	| { kind: 'metadata'; metadata: AgentWireMetadata }
	| { kind: 'plan-limit'; limit: AgentPlanLimitWire }
	| {
			kind: 'plan-windows';
			/**
			 * Every window the plan reports, read from the runtime in one round trip
			 * rather than pushed. Carries no spend verdict: a read says where each
			 * window stands, while `plan-limit` carries the verdict a push announced.
			 */
			windows: readonly AgentPlanLimitWindowWire[];
	  }
	| { cost: AgentSessionCostWire; kind: 'session-cost' }
	| {
			kind: 'status';
			previous: AgentSessionStatusWire;
			status: AgentSessionStatusWire;
	  }
	| { kind: 'shutdown'; reason: string };
