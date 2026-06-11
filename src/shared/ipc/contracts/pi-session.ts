import type {
	PiEventStreamWire,
	PiPersistedEnvelope,
	PiSessionStatusWire,
} from './pi-message-payloads.ts';

export type {
	PiContextUsageWire,
	PiEventStreamWire,
	PiPersistedEnvelope,
	PiSessionStatusWire,
	PiWireError,
	PiWireMessagePart,
	PiWireMessagePayload,
	PiWireMetadata,
} from './pi-message-payloads.ts';

export type ChatTabKindWire = 'chat' | 'diff' | 'document' | 'file' | 'preview';

/** Renderer-facing chat tab descriptor. */
export interface PiChatTabWire {
	id: string;
	kind: ChatTabKindWire;
	openedAt: string;
	piSessionId: string | null;
	position: number;
	title: string;
	workspaceId: string;
}

/** Renderer-facing snapshot of a Pi session row plus its tab/branch context. */
export interface PiSessionSnapshotWire {
	branchId: string;
	closedAt: string | null;
	createdAt: string;
	cwd: string;
	id: string;
	label: string | null;
	model: string | null;
	openedTabs: readonly PiChatTabWire[];
	piSessionId: string | null;
	/** True when a Pi RPC child is currently attached for this session. */
	runtimeOpen: boolean;
	status: PiSessionStatusWire;
	thinkingLevel: string | null;
	updatedAt: string;
	workspaceId: string;
}

/** Renderer-facing event row read back from `pi_session_events`. */
export interface PiSessionEventWire {
	branchId: string;
	createdAt: string;
	eventType: string;
	id: string;
	ordinal: number;
	/**
	 * Tagged envelope. `null` only when the row predates this contract or the
	 * JSON failed to parse on read; renderers should treat null as a no-op.
	 */
	payload: PiPersistedEnvelope | null;
	stream: PiEventStreamWire;
	turnId: string | null;
}

/** Open or attach a Pi session for a workspace. */
export interface OpenPiSessionRequest {
	/**
	 * When supplied, the resulting Pi session is bound to this chat tab via
	 * the chat-tab repository's `bindPiSession` helper so the renderer can
	 * resume the same tab on next listing.
	 */
	chatTabId?: string | null;
	/** First user prompt, used only to generate a short tab title. */
	initialPrompt?: string | null;
	label?: string;
	/** Existing Ensemble Pi session id to reopen with native Pi history. */
	resumeSessionId?: string | null;
	model?: string | null;
	thinkingLevel?: string | null;
	workspaceCwd: string;
	workspaceId: string;
}

export interface OpenPiSessionResult {
	error?: string;
	session?: PiSessionSnapshotWire;
}

/** Submit a prompt to an open Pi session. */
export interface SubmitPiPromptRequest {
	model?: string | null;
	prompt: string;
	sessionId: string;
	thinkingLevel?: string | null;
}

export interface SubmitPiPromptResult {
	acceptedAt?: string;
	error?: string;
	turnId?: string;
}

/** Stop the currently-streaming turn in a Pi session. */
export interface StopPiSessionRequest {
	reason?: string;
	sessionId: string;
}

export interface StopPiSessionResult {
	error?: string;
	ok: boolean;
}

/** List Pi sessions persisted for a workspace. */
export interface ListPiSessionsRequest {
	workspaceId: string;
}

export interface ListPiSessionsResult {
	sessions: readonly PiSessionSnapshotWire[];
}

/** Read persisted events for a branch (rehydrating the timeline on reopen). */
export interface ListPiSessionEventsRequest {
	branchId: string;
}

export interface ListPiSessionEventsResult {
	events: readonly PiSessionEventWire[];
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
export interface PiSessionEventBroadcast {
	event: PiSessionEventWire;
	sessionId: string;
	workspaceId: string;
}

/**
 * Coarse kind tag attached to every raw Pi frame so the debug panel can
 * scope traffic to user-facing chat vs. internal Ensemble jobs (chat-title
 * generation, session-summary generation). Derived from the session label
 * supplied at adapter create time.
 */
export type PiRawFrameKind = 'chat' | 'title' | 'summary' | 'unknown';

/**
 * Raw JSONL line as exchanged between Ensemble and a Pi RPC subprocess.
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

/** Lightweight static model descriptor surfaced by the discovery stub. */
export interface PiModelOptionWire {
	displayName: string;
	id: string;
	provider: string;
	thinkingLevels: readonly string[];
}

export interface ListPiModelsResult {
	defaultModelId: string | null;
	defaultThinkingLevel: string | null;
	models: readonly PiModelOptionWire[];
}

/**
 * Pi session IPC surface (open / submit / stop / list, plus the live event
 * subscription). CHAT-FRAGILE — keep these signatures byte-for-byte identical
 * to the legacy `EnsembleApi` slice; channel handlers key off the method names.
 */
export interface PiSessionApi {
	listPiModels: () => Promise<ListPiModelsResult>;
	listPiSessionEvents: (
		request: ListPiSessionEventsRequest,
	) => Promise<ListPiSessionEventsResult>;
	listPiSessions: (
		request: ListPiSessionsRequest,
	) => Promise<ListPiSessionsResult>;
	onPiRawFrame: (listener: (frame: PiRawFrameBroadcast) => void) => () => void;
	onPiSessionEvent: (
		listener: (event: PiSessionEventBroadcast) => void,
	) => () => void;
	openPiSession: (
		request: OpenPiSessionRequest,
	) => Promise<OpenPiSessionResult>;
	stopPiSession: (
		request: StopPiSessionRequest,
	) => Promise<StopPiSessionResult>;
	submitPiPrompt: (
		request: SubmitPiPromptRequest,
	) => Promise<SubmitPiPromptResult>;
	writeForkSummary: (
		request: WriteForkSummaryRequest,
	) => Promise<WriteForkSummaryResult>;
}

export interface PiExecutableSelectionResult {
	canceled: boolean;
	error?: string;
	selectedPath?: string;
}

/** Source category for a slash command that Pi can accept through prompt input. */
export type PiSlashCommandSource = 'builtin' | 'extension' | 'prompt' | 'skill';

/** Scope of the Pi resource that registered a slash command. */
export type PiSlashCommandSourceScope = 'project' | 'temporary' | 'user';

/** IPC-safe slash command metadata shown in the composer autocomplete menu. */
export interface PiSlashCommandWire {
	autoSubmit: boolean;
	command: string;
	description: string;
	source: PiSlashCommandSource;
	sourceScope?: PiSlashCommandSourceScope;
}

/** Request for resolving Pi slash commands within a workspace directory. */
export interface ListPiSlashCommandsRequest {
	cwd?: string;
}

/** Response containing live Pi slash commands or static fallback commands. */
export interface ListPiSlashCommandsResult {
	commands: readonly PiSlashCommandWire[];
	error: string | null;
	source: 'sdk' | 'static';
}

/** Pi runtime / executable IPC surface (locate the Pi binary, etc). */
export interface PiApi {
	listPiSlashCommands: (
		request?: ListPiSlashCommandsRequest,
	) => Promise<ListPiSlashCommandsResult>;
	selectPiExecutable: () => Promise<PiExecutableSelectionResult>;
}
