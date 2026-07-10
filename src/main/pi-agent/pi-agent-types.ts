import type {
	PiWireMessagePart,
	PiWireMessagePayload,
} from '../../shared/ipc/contracts/pi-session';
import type { PiExecutableSnapshot } from '../pi-runtime/pi-executable.ts';

/** Stable identifier for a Pi agent session within the main process. */
export type PiAgentSessionId = string;

/** Lifecycle stage reported by the underlying Pi runtime. */
export type PiAgentSessionStatus =
	| 'closed'
	| 'errored'
	| 'idle'
	| 'starting'
	| 'streaming';

/** Why a session finished or was torn down. */
export type PiAgentShutdownReason =
	| 'aborted'
	| 'completed'
	| 'crashed'
	| 'manual';

/** Stable error taxonomy raised across the PiAgentClient boundary. */
export type PiAgentErrorCode =
	| 'adapter-failure'
	| 'invalid-cwd'
	| 'invalid-executable'
	| 'session-closed'
	| 'spawn-error'
	| 'submit-failed';

/** Boundary-level error attached to events or thrown from API methods. */
export interface PiAgentError {
	code: PiAgentErrorCode;
	detail?: string;
	message: string;
	recoverable: boolean;
}

/** Model attribution exposed by the Pi runtime, when known. */
export interface PiAgentModelMetadata {
	displayName?: string;
	id: string;
	provider: string;
}

/** Thinking/reasoning mode metadata exposed by the Pi runtime, when known. */
export interface PiAgentThinkingMetadata {
	budgetTokens?: number;
	mode: 'high' | 'low' | 'medium' | 'off';
}

/** Snapshot of session state, returned by `PiAgentSession.getMetadata`. */
export interface PiAgentSessionMetadata {
	args: readonly string[];
	command: string;
	cwd: string;
	env: Record<string, string>;
	id: PiAgentSessionId;
	label: string;
	model: PiAgentModelMetadata | null;
	piAgentDirectoryPreserved: boolean;
	sessionId: string | null;
	startedAt: string;
	status: PiAgentSessionStatus;
	thinking: PiAgentThinkingMetadata | null;
	updatedAt: string;
}

/** Caller-supplied request that opens a Pi agent session. */
export interface PiAgentSessionRequest {
	/** Resolved Pi executable. Used as the spawn command. */
	executable: PiExecutableSnapshot;
	/** Working directory for the launched process — typically the workspace path. */
	workspaceCwd: string;
	/** Caller-supplied env overlay. `null` or `undefined` values are treated as "unset". */
	env?: Record<string, string | null | undefined>;
	/**
	 * When true (default), the client refuses to inject `PI_CODING_AGENT_DIR`
	 * into the launched env, even if the caller passes it. The user's shell
	 * value flows through untouched. Set to false to allow an explicit override.
	 */
	preservePiAgentDirectory?: boolean;
	/**
	 * Optional model override propagated to the Pi runtime as the `--model`
	 * spawn flag. Accepts Pi's `provider/id` pattern (e.g. `anthropic/claude…`).
	 */
	modelOverride?: string | null;
	/**
	 * Optional thinking/reasoning level propagated to the Pi runtime as the
	 * `--thinking` spawn flag (e.g. `off`, `low`, `medium`, `high`, `xhigh`).
	 */
	thinkingLevel?: string | null;
	/** Optional human-readable label attached to session metadata for logs. */
	label?: string;
	/** Native Pi session id to create or resume with `pi --session-id`. */
	piSessionId?: string | null;
}

/** Inline or referenced attachment included with a prompt submission. */
export interface PiAgentSubmitAttachment {
	contentBase64?: string;
	kind: 'file' | 'inline';
	name: string;
	path?: string;
}

/** Caller-supplied prompt submission. */
export interface PiAgentSubmitRequest {
	attachments?: readonly PiAgentSubmitAttachment[];
	/**
	 * Model to apply for this turn. When it differs from the model the runtime
	 * is already on, the adapter emits a `set_model` RPC command before the
	 * prompt so mid-session switches take effect without a respawn.
	 */
	modelOverride?: string;
	/**
	 * Thinking level to apply for this turn. Mirrors {@link modelOverride}: a
	 * change triggers a `set_thinking_level` RPC command before the prompt.
	 */
	thinkingLevel?: string;
	prompt: string;
	/**
	 * Mid-turn delivery mode. When set, the adapter emits a `steer` or
	 * `follow_up` RPC frame instead of a plain `prompt` (which Pi rejects while
	 * streaming) and skips per-turn model/thinking changes.
	 */
	streamingBehavior?: 'steer' | 'followUp';
}

/** Acknowledgement returned synchronously after a successful submit. */
export interface PiAgentSubmitAcknowledgement {
	acceptedAt: string;
	turnId: string;
}

/**
 * Tagged union of normalized message payloads emitted by the adapter. Each
 * variant maps to a single chat-timeline concept; the renderer mapper consumes
 * this union directly so it never sniffs Pi's wire shapes.
 *
 *   text         — assistant text (or user prompt echo)
 *   reasoning    — assistant reasoning/thinking content
 *   tool-call    — tool invocation with id, name, and structured input
 *   tool-result  — tool execution outcome, with `isError` discriminator
 *   message      — composite assistant/user message (multi-part content)
 *   prompt       — synthetic submit-side user echo carrying the original prompt
 *   unknown      — forward-compatible passthrough for frames we have not modelled
 *
 * The shared `PiWireMessagePart`/`PiWireMessagePayload` aliases are the
 * canonical boundary types. Main-process and renderer code reference them by
 * either name with full structural parity guaranteed by the type system.
 */
export type PiAgentMessagePart = PiWireMessagePart;

/** Normalized message payload emitted by the adapter; alias of the shared {@link PiWireMessagePayload} boundary type. */
export type PiAgentMessagePayload = PiWireMessagePayload;

/** Context-window usage reported by a session: total window size and current token consumption. */
export interface PiAgentContextUsage {
	contextWindow: number;
	percent: number | null;
	tokens: number | null;
}

/** Discriminated event stream emitted by a session. */
export type PiAgentEvent =
	| {
			at: string;
			type: 'context-usage';
			usage: PiAgentContextUsage;
	  }
	| {
			at: string;
			error: PiAgentError;
			type: 'error';
	  }
	| {
			at: string;
			metadata: PiAgentSessionMetadata;
			type: 'metadata';
	  }
	| {
			at: string;
			payload: PiAgentMessagePayload;
			role: 'agent' | 'tool' | 'user';
			turnId: string | null;
			type: 'message';
	  }
	| {
			at: string;
			previous: PiAgentSessionStatus;
			status: PiAgentSessionStatus;
			type: 'status';
	  }
	| {
			at: string;
			reason: PiAgentShutdownReason;
			type: 'shutdown';
	  };

/** Listener registered through `PiAgentSession.subscribe`. */
export type PiAgentEventListener = (event: PiAgentEvent) => void;

/** Handle returned by `PiAgentSession.subscribe`. */
export interface PiAgentSubscription {
	unsubscribe: () => void;
}
