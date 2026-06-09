/** Wire-side enums mirrored from the main-process Pi session repository. */
export type PiSessionStatusWire =
	| 'idle'
	| 'starting'
	| 'streaming'
	| 'closed'
	| 'errored';

export type ChatTabKindWire = 'chat' | 'preview';

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
 */
export type PiWireMessagePayload =
	| { kind: 'text'; text: string }
	| { kind: 'reasoning'; text: string }
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

/**
 * Tagged union persisted into `pi_session_events.payload_json` and replayed on
 * the renderer. Each variant maps 1:1 to a `PiAgentEvent` discriminant; the
 * envelope shape is stable so the renderer can match on `envelope.kind`
 * without sniffing raw Pi frames.
 */
export type PiPersistedEnvelope =
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

/** Live envelope pushed from the main process when an event lands. */
export interface PiSessionEventBroadcast {
	event: PiSessionEventWire;
	sessionId: string;
	workspaceId: string;
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
}
