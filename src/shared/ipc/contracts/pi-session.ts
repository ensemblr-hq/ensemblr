/** Wire-side enums mirrored from the main-process Pi session repository. */
export type PiSessionStatusWire =
	| 'idle'
	| 'starting'
	| 'streaming'
	| 'closed'
	| 'errored';

export type ChatTabKindWire = 'chat' | 'preview';

export type PiEventStreamWire = 'protocol' | 'stderr';

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
	payload: unknown;
	stream: PiEventStreamWire;
	turnId: string | null;
}

/** Open or attach a Pi session for a workspace. */
export interface OpenPiSessionRequest {
	label?: string;
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
