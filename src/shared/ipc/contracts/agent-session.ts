import type { AgentProviderId } from '../../agent-provider.ts';
import type {
	AgentEventStreamWire,
	AgentPersistedEnvelope,
	AgentSessionStatusWire,
} from './agent-message-payloads.ts';
import type { AgentModelCatalog } from './agent-models.ts';

export type {
	AgentEventStreamWire,
	AgentPersistedEnvelope,
	AgentPlanLimitStatusWire,
	AgentPlanLimitWindowWire,
	AgentPlanLimitWire,
	AgentSessionCostWire,
	AgentSessionStatusWire,
	AgentWireError,
	AgentWireMessagePart,
	AgentWireMessagePayload,
	AgentWireMetadata,
} from './agent-message-payloads.ts';

/** Kind of chat tab surfaced to the renderer. */
export type ChatTabKindWire =
	| 'chat'
	| 'diff'
	| 'document'
	| 'file'
	| 'preview'
	| 'terminal';

/** Renderer-facing chat tab descriptor. */
export interface AgentChatTabWire {
	/**
	 * Foreign key to the Ensemblr agent session bound to this tab
	 * (`agent_sessions.id`), or null when none is. This is the id every Ensemblr
	 * session API takes — never a runtime's own id. See
	 * {@link AgentSessionSnapshotWire.runtimeSessionId} for that one.
	 */
	agentSessionId: string | null;
	/** Untruncated title; `title` is capped for tab display. */
	fullTitle: string;
	id: string;
	kind: ChatTabKindWire;
	openedAt: string;
	position: number;
	title: string;
	workspaceId: string;
}

/** Renderer-facing snapshot of an agent session row plus its tab/branch context. */
export interface AgentSessionSnapshotWire {
	branchId: string;
	closedAt: string | null;
	createdAt: string;
	cwd: string;
	id: string;
	label: string | null;
	model: string | null;
	openedTabs: readonly AgentChatTabWire[];
	/**
	 * Agent runtime this session is pinned to. The model picker reads it to
	 * disable other providers' models once a chat has a session.
	 */
	provider: AgentProviderId;
	/** True when an agent runtime child is currently attached for this session. */
	runtimeOpen: boolean;
	/**
	 * Session id the agent runtime itself uses for the process Ensemblr manages —
	 * what Pi is handed as `--session-id`. Not a foreign key: this session's own
	 * Ensemblr id is `id`, and {@link AgentChatTabWire.agentSessionId} is the
	 * reference to it. Only `id` may be passed to Ensemblr session APIs.
	 */
	runtimeSessionId: string | null;
	status: AgentSessionStatusWire;
	thinkingLevel: string | null;
	updatedAt: string;
	workspaceId: string;
}

/** Renderer-facing event row read back from `agent_session_events`. */
export interface AgentSessionEventWire {
	branchId: string;
	createdAt: string;
	eventType: string;
	id: string;
	ordinal: number;
	/**
	 * Tagged envelope. `null` only when the row predates this contract or the
	 * JSON failed to parse on read; renderers should treat null as a no-op.
	 */
	payload: AgentPersistedEnvelope | null;
	stream: AgentEventStreamWire;
	turnId: string | null;
}

/** Open or attach an agent session for a workspace. */
export interface OpenAgentSessionRequest {
	/**
	 * When supplied, the resulting agent session is bound to this chat tab via
	 * the chat-tab repository's `bindAgentSession` helper so the renderer can
	 * resume the same tab on next listing.
	 */
	chatTabId?: string | null;
	/** First user prompt, used only to generate a short tab title. */
	initialPrompt?: string | null;
	label?: string;
	/**
	 * Absolute paths outside the workspace this chat may read. The renderer's
	 * per-chat setting is the durable source and re-sends this on every open;
	 * runtimes that sandbox by working directory grant them at launch, which is
	 * why a directory linked mid-session only takes effect on the next open.
	 */
	linkedDirectories?: readonly string[];
	/**
	 * Whether the chat's Plan Mode toggle is on. The renderer's per-chat setting
	 * is the durable source and re-sends this on every open and submit, so the
	 * main-process registry is a derived, in-memory mirror.
	 */
	planMode?: boolean;
	/** Existing Ensemblr agent session id to reopen with native runtime history. */
	resumeSessionId?: string | null;
	model?: string | null;
	thinkingLevel?: string | null;
	workspaceCwd: string;
	workspaceId: string;
}

/** Result of opening or attaching an agent session. */
export interface OpenAgentSessionResult {
	error?: string;
	session?: AgentSessionSnapshotWire;
}

/**
 * Mid-turn delivery mode for a prompt submitted while the agent is streaming.
 * `steer` injects after the current turn's tool calls (Pi `steer` command);
 * `followUp` is held until the agent fully stops (Pi `follow_up` command).
 * Omitted for a normal idle submit (plain `prompt`).
 */
export type PiStreamingBehavior = 'steer' | 'followUp';

/** Submit a prompt to an open agent session. */
export interface SubmitAgentPromptRequest {
	model?: string | null;
	/** Whether the chat's Plan Mode toggle is on for this turn. */
	planMode?: boolean;
	prompt: string;
	sessionId: string;
	/** Mid-turn delivery mode; omit for a normal (idle) submit. */
	streamingBehavior?: PiStreamingBehavior;
	thinkingLevel?: string | null;
}

/** Result of submitting a prompt to an open agent session. */
export interface SubmitAgentPromptResult {
	acceptedAt?: string;
	error?: string;
	turnId?: string;
}

/** Stop the currently-streaming turn in an agent session. */
export interface StopAgentSessionRequest {
	reason?: string;
	sessionId: string;
}

/** Result of stopping the currently-streaming turn in an agent session. */
export interface StopAgentSessionResult {
	error?: string;
	ok: boolean;
}

/**
 * Mirror the chat's Plan Mode toggle into the main process without sending a
 * prompt. Every other write of this flag rides `openAgentSession` or
 * `submitAgentPrompt`; hand-off turns the toggle off and submits nothing, so it
 * needs its own channel or main keeps treating the session as still planning.
 */
export interface SetAgentPlanModeRequest {
	planMode: boolean;
	sessionId: string;
}

/** List agent sessions persisted for a workspace. */
export interface ListAgentSessionsRequest {
	workspaceId: string;
}

/** Result of listing agent sessions persisted for a workspace. */
export interface ListAgentSessionsResult {
	sessions: readonly AgentSessionSnapshotWire[];
}

/** Read persisted events for a branch (rehydrating the timeline on reopen). */
export interface ListAgentSessionEventsRequest {
	branchId: string;
}

/** Result of reading persisted events for a branch. */
export interface ListAgentSessionEventsResult {
	events: readonly AgentSessionEventWire[];
}

/**
 * Write a markdown summary of a conversation branch for forking. The summary
 * lands under `<targetWorkspaceCwd>/.context/sessions/` so the new chat can
 * attach it as a file chip.
 */
export interface WriteForkSummaryRequest {
	branchId: string;
	/** Filename stem for the summary, e.g. the destination chat-tab id. */
	fileBaseName: string;
	sessionId: string;
	/** Absolute workspace root to write into; defaults to the session cwd. */
	targetWorkspaceCwd?: string;
	/** Inclusive event-ordinal bound; omit to summarize the whole branch. */
	upToOrdinal?: number;
}

/** Result of writing a fork summary; carries the summary file's paths and title on success. */
export interface WriteForkSummaryResult {
	error?: string;
	summary?: {
		absolutePath: string;
		/** Path relative to the target workspace root. */
		relativePath: string;
		title: string | null;
	};
}

/** Live envelope pushed from the main process when an event lands. */
export interface AgentSessionEventBroadcast {
	event: AgentSessionEventWire;
	sessionId: string;
	workspaceId: string;
}

/**
 * Coarse kind tag attached to every raw Pi frame so the debug panel can scope
 * traffic to user-facing chat. Derived from the session label supplied at
 * adapter create time; Ensemblr no longer runs any ephemeral Pi job of its own,
 * so everything else is `unknown`.
 */
export type PiRawFrameKind = 'chat' | 'unknown';

/**
 * Raw JSONL line as exchanged between Ensemblr and a Pi RPC subprocess.
 * Surfaced to the renderer only for the temporary debug panel — never
 * persisted to SQLite. `direction` indicates whether the line was written
 * TO Pi's stdin (`tx`) or received FROM its stdout (`rx`).
 */
export interface PiRawFrameBroadcast {
	at: string;
	direction: 'rx' | 'tx';
	kind: PiRawFrameKind;
	label: string;
	line: string;
	sessionId: string;
}

/**
 * Agent session IPC surface (open / submit / stop / list, plus the live event
 * subscription). CHAT-FRAGILE — keep these signatures byte-for-byte identical
 * to the legacy `EnsemblrApi` slice; channel handlers key off the method names.
 */
export interface AgentSessionApi {
	listAgentModels: () => Promise<AgentModelCatalog>;
	listAgentSessionEvents: (
		request: ListAgentSessionEventsRequest,
	) => Promise<ListAgentSessionEventsResult>;
	listAgentSessions: (
		request: ListAgentSessionsRequest,
	) => Promise<ListAgentSessionsResult>;
	onAgentSessionEvent: (
		listener: (event: AgentSessionEventBroadcast) => void,
	) => () => void;
	onPiRawFrame: (listener: (frame: PiRawFrameBroadcast) => void) => () => void;
	openAgentSession: (
		request: OpenAgentSessionRequest,
	) => Promise<OpenAgentSessionResult>;
	setAgentPlanMode: (request: SetAgentPlanModeRequest) => Promise<void>;
	stopAgentSession: (
		request: StopAgentSessionRequest,
	) => Promise<StopAgentSessionResult>;
	submitAgentPrompt: (
		request: SubmitAgentPromptRequest,
	) => Promise<SubmitAgentPromptResult>;
	writeForkSummary: (
		request: WriteForkSummaryRequest,
	) => Promise<WriteForkSummaryResult>;
}
