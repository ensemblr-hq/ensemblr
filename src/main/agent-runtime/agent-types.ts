import type { SubagentMechanism } from '../../shared/agent-control';
import type { AgentProviderId } from '../../shared/agent-provider';
import type {
	AgentPlanLimitWire,
	AgentSessionCostWire,
	AgentWireMessagePart,
	AgentWireMessagePayload,
} from '../../shared/ipc/contracts/agent-session';
import type { PermissionMode } from '../../shared/permissions';

/** Stable identifier for an agent session within the main process. */
export type AgentSessionId = string;

/** Lifecycle stage reported by an agent runtime. */
export type AgentSessionStatus =
	| 'closed'
	| 'errored'
	| 'idle'
	| 'starting'
	| 'streaming';

/** Why a session finished or was torn down. */
export type AgentShutdownReason =
	| 'aborted'
	| 'completed'
	| 'crashed'
	| 'manual';

/** Stable error taxonomy raised across the agent client boundary. */
export type AgentErrorCode =
	| 'adapter-failure'
	| 'invalid-cwd'
	| 'invalid-executable'
	| 'session-closed'
	| 'spawn-error'
	| 'submit-failed';

/** Boundary-level error attached to events or thrown from API methods. */
export interface AgentError {
	code: AgentErrorCode;
	detail?: string;
	message: string;
	recoverable: boolean;
}

/**
 * The part of a resolved executable this layer needs: what to run and whether
 * it is runnable. Declared structurally rather than imported from `pi-runtime`
 * so the shared layer stays free of any one provider's discovery machinery —
 * `PiExecutableSnapshot` satisfies it as-is.
 */
export interface AgentExecutableSnapshot {
	command: string;
	status: 'error' | 'ok' | 'warning';
}

/** Model attribution exposed by an agent runtime, when known. */
export interface AgentModelMetadata {
	displayName?: string;
	id: string;
	provider: string;
}

/** Thinking/reasoning mode metadata exposed by an agent runtime, when known. */
export interface AgentThinkingMetadata {
	budgetTokens?: number;
	mode: 'high' | 'low' | 'medium' | 'off';
}

/**
 * Loopback Ensemblr Control endpoint handed to a runtime that speaks MCP
 * natively. Pi reaches the same server through its extension instead, so this
 * stays unset on Pi requests.
 */
export interface AgentControlMcpConfig {
	token: string;
	url: string;
}

/**
 * Snapshot of session state, returned by `AgentSession.getMetadata`.
 *
 * `args` and `command` describe whatever the adapter actually launches. The
 * CLI RPC adapter fills them with `pi`'s argv; the Claude adapter leaves `args`
 * empty and sets only `command`, because the SDK owns its own argv.
 *
 * `id` is the `agent_sessions.id` row key the request opened under — the same id
 * the renderer addresses the chat by. Its neighbour `sessionId` is the
 * runtime-native id (`AgentSessionRequest.runtimeSessionId`), which only the
 * runtime understands. The two are never interchangeable.
 */
export interface AgentSessionMetadata {
	args: readonly string[];
	command: string;
	cwd: string;
	env: Record<string, string>;
	id: AgentSessionId;
	label: string;
	model: AgentModelMetadata | null;
	piAgentDirectoryPreserved: boolean;
	provider: AgentProviderId;
	sessionId: string | null;
	startedAt: string;
	status: AgentSessionStatus;
	thinking: AgentThinkingMetadata | null;
	updatedAt: string;
}

/** Live session state polled from the runtime. */
export interface AgentSessionState {
	/** User-set display name (Pi `/name`), or null when unset. */
	sessionName: string | null;
}

/**
 * Caller-supplied request that opens an agent session. The shape is
 * provider-neutral: each adapter maps it onto its own runtime, so the client
 * never learns a CLI's flags or an SDK's option names.
 */
export interface AgentSessionRequest {
	/**
	 * Which agent runtime should serve the session. Defaults to `pi`, so every
	 * caller predating a second provider keeps its behaviour unchanged.
	 */
	provider?: AgentProviderId;
	/**
	 * Resolved executable to launch. Required for `pi`. For every other runtime,
	 * absent states no opinion and lets the adapter pick, while a snapshot whose
	 * status is `error` is rejected — no runtime ships its own binary.
	 */
	executable?: AgentExecutableSnapshot | null;
	/** Working directory for the launched process — typically the workspace path. */
	workspaceCwd: string;
	/**
	 * Absolute paths outside `workspaceCwd` the session may read. Runtimes that
	 * sandbox by working directory take these at launch, so the set is fixed for
	 * the life of the session; runtimes that do not sandbox ignore them and see
	 * the same paths announced in the prompt.
	 */
	linkedDirectories?: readonly string[];
	/** Caller-supplied env overlay. `null` or `undefined` values are treated as "unset". */
	env?: Record<string, string | null | undefined>;
	/**
	 * When true (default), the client refuses to inject `PI_CODING_AGENT_DIR`
	 * into the launched env, even if the caller passes it. The user's shell
	 * value flows through untouched. Set to false to allow an explicit override.
	 */
	preservePiAgentDirectory?: boolean;
	/** Model to open the session on, in whatever form the target runtime names models. */
	modelOverride?: string | null;
	/** Thinking/reasoning level to open the session on (`off`, `low`, … `xhigh`). */
	thinkingLevel?: string | null;
	/** Workspace permission mode the session must honour, translated per runtime. */
	permissionMode?: PermissionMode;
	/** Opens the session in the runtime's plan mode, where writes wait on an approved plan. */
	planMode?: boolean;
	/** Ensemblr Control MCP endpoint, for runtimes that speak MCP natively. */
	controlMcp?: AgentControlMcpConfig | null;
	/**
	 * Which delegation mechanism the session opens under. A runtime shipping a
	 * sub-agent tool of its own denies that tool under `ensemblr`, so the user's
	 * choice is enforced rather than merely stated in the playbook. Runtimes with
	 * no sub-agent tool ignore it. Defaults to `ensemblr`.
	 */
	delegation?: SubagentMechanism;
	/** Extra instructions appended to the runtime's own system prompt. */
	systemPromptAppend?: string | null;
	/**
	 * Resolves the app's per-turn upkeep block, prepended to each prompt the
	 * runtime receives and to nothing the user sees. A runtime whose system
	 * prompt is fixed at session open has no other way to be told what naming the
	 * session still owes, because that is live state the opening prompt predates.
	 */
	resolveTurnPreamble?: (() => Promise<string | null>) | null;
	/** Optional human-readable label attached to session metadata for logs. */
	label?: string;
	/**
	 * The Ensemblr `agent_sessions.id` row key this session belongs to. Required,
	 * because it is the only id the renderer knows a chat by: anything an adapter
	 * addresses at a chat tab — an approval card, a plan panel — has to be keyed by
	 * this or it lands nowhere.
	 *
	 * Contrast its neighbour {@link runtimeSessionId}, which is the runtime's own
	 * id for the same session and is meaningless to the renderer. The two are never
	 * interchangeable. `AgentSessionMetadata.id` carries this same value back out,
	 * so a session handle and its row are addressable by one id.
	 */
	agentSessionId: string;
	/**
	 * Runtime-native session id the launched process should create or resume
	 * under — Pi receives it as `--session-id`. Never the Ensemblr
	 * `agent_sessions.id` that the caller's row is keyed by; that is
	 * {@link agentSessionId}.
	 */
	runtimeSessionId?: string | null;
	/**
	 * Whether the runtime has already run under {@link runtimeSessionId} and holds
	 * that conversation's history.
	 *
	 * An adapter cannot infer this from the id alone: every open carries one —
	 * minted for a fresh session, replayed from the row for a resume — so its
	 * presence says nothing about whether the runtime has ever seen it. Only the
	 * caller that read the row knows, so it states the answer here.
	 *
	 * Claude needs the two kept apart: its SDK loads a transcript for `resume` and
	 * the CLI exits with `No conversation found with session ID` when there is
	 * none, while `sessionId` assigns the id and cannot be combined with `resume`.
	 * Pi ignores the flag, because `pi --session-id` uses the "exact project
	 * session ID, creating it if missing" and is create-or-resume either way.
	 */
	resumeRuntimeSession?: boolean;
}

/** Inline or referenced attachment included with a prompt submission. */
export interface AgentSubmitAttachment {
	contentBase64?: string;
	kind: 'file' | 'inline';
	name: string;
	path?: string;
}

/** Caller-supplied prompt submission. */
export interface AgentSubmitRequest {
	attachments?: readonly AgentSubmitAttachment[];
	/**
	 * Model to apply for this turn. When it differs from the model the runtime
	 * is already on, the adapter switches the runtime before the prompt so
	 * mid-session changes take effect without a respawn.
	 */
	modelOverride?: string;
	/** Thinking level to apply for this turn. Mirrors {@link modelOverride}. */
	thinkingLevel?: string;
	/**
	 * Whether the chat's Plan Mode toggle is on for this turn. Re-sent every turn
	 * because a runtime that owns its own plan mode can leave it without telling
	 * Ensemblr — Claude's native `ExitPlanMode` does exactly that — so the toggle
	 * has to be re-asserted rather than set once at session open. Runtimes whose
	 * plan mode Ensemblr enforces itself (Pi, through the plan-mode registry)
	 * ignore it.
	 */
	planMode?: boolean;
	prompt: string;
	/**
	 * Mid-turn delivery mode. When set, the adapter uses its runtime's steer or
	 * follow-up channel instead of a plain prompt (which Pi rejects while
	 * streaming) and skips per-turn model/thinking changes.
	 */
	streamingBehavior?: 'steer' | 'followUp';
}

/** Acknowledgement returned synchronously after a successful submit. */
export interface AgentSubmitAcknowledgement {
	acceptedAt: string;
	turnId: string;
}

/**
 * Canonical message-part shape. Aliased onto the wire contract so a new variant
 * added there is enforced across main and renderer by the type system. The wire
 * type names the serialized format persisted in
 * `agent_session_events.payload_json`, which every provider shares.
 */
export type AgentMessagePart = AgentWireMessagePart;

/**
 * Tagged union of normalized message payloads emitted by an adapter. Each
 * variant maps to a single chat-timeline concept; the renderer mapper consumes
 * it directly so it never sniffs a runtime's own wire shapes.
 *
 *   text         — assistant text (or user prompt echo)
 *   reasoning    — assistant reasoning/thinking content
 *   tool-call    — tool invocation with id, name, and structured input
 *   tool-result  — tool execution outcome, with `isError` discriminator
 *   message      — composite assistant/user message (multi-part content)
 *   prompt       — synthetic submit-side user echo carrying the original prompt
 *   unknown      — forward-compatible passthrough for frames we have not modelled
 */
export type AgentMessagePayload = AgentWireMessagePayload;

/** Context-window usage reported by a session: window size and current consumption. */
export interface AgentContextUsage {
	contextWindow: number;
	percent: number | null;
	tokens: number | null;
}

/**
 * Plan rate-limit window reported by a session. Only runtimes backed by a
 * claude.ai subscription report these; an API-key, Bedrock, or Vertex session has
 * no plan limits to report and emits none.
 */
export type AgentPlanLimit = AgentPlanLimitWire;

/** Running cost totals a session reports for itself. */
export type AgentSessionCost = AgentSessionCostWire;

/** Discriminated event stream emitted by a session. */
export type AgentEvent =
	| {
			at: string;
			type: 'context-usage';
			usage: AgentContextUsage;
	  }
	| {
			at: string;
			cost: AgentSessionCost;
			type: 'session-cost';
	  }
	| {
			at: string;
			limit: AgentPlanLimit;
			type: 'plan-limit';
	  }
	| {
			at: string;
			error: AgentError;
			type: 'error';
	  }
	| {
			at: string;
			metadata: AgentSessionMetadata;
			type: 'metadata';
	  }
	| {
			at: string;
			/**
			 * Tool call whose subagent produced this message, absent on the main
			 * thread. Mirrors the Claude SDK's `parent_tool_use_id`; adapters whose
			 * runtime has no subagents leave it unset.
			 */
			parentToolCallId?: string;
			payload: AgentMessagePayload;
			role: 'agent' | 'tool' | 'user';
			turnId: string | null;
			type: 'message';
	  }
	| {
			at: string;
			previous: AgentSessionStatus;
			status: AgentSessionStatus;
			type: 'status';
	  }
	| {
			at: string;
			reason: AgentShutdownReason;
			type: 'shutdown';
	  };

/** Listener registered through `AgentSession.subscribe`. */
export type AgentEventListener = (event: AgentEvent) => void;

/** Handle returned by `AgentSession.subscribe`. */
export interface AgentSubscription {
	unsubscribe: () => void;
}

/**
 * True when an executable snapshot is good enough to launch. Mirrors
 * `pi-runtime`'s own readiness rule so the shared layer can validate any
 * provider's executable without importing that concern.
 * @param executable - Resolved executable snapshot to test.
 * @returns True when the command is set and discovery did not fail.
 */
export function isAgentExecutableReady(
	executable: AgentExecutableSnapshot,
): boolean {
	return Boolean(executable.command) && executable.status !== 'error';
}
