/**
 * Wire contracts for chat-tab IPC. Mirrors the renderer-facing shape of
 * `chat_tabs` rows so the renderer never depends on storage internals.
 */
import type { ChatTabKindWire } from './pi-session.ts';

/** Renderer-facing snapshot of a chat-tab row. */
export interface ChatTabWire {
	closedAt: string | null;
	id: string;
	kind: ChatTabKindWire;
	openedAt: string;
	piSessionId: string | null;
	position: number;
	title: string;
	workspaceId: string;
}

/**
 * Renderer-facing description of a closed tab plus the path to its persisted
 * session summary. The summary file lives under `<workspaceCwd>/.context/sessions`.
 */
export interface ClosedChatTabEntryWire {
	closedAt: string;
	summaryPath: string;
	summaryTitle: string | null;
	tab: ChatTabWire;
}

/** List all chat tabs (open + closed) for a workspace. */
export interface ListChatTabsRequest {
	workspaceId: string;
}

export interface ListChatTabsResult {
	closed: readonly ChatTabWire[];
	open: readonly ChatTabWire[];
}

/** Open a new chat tab in a workspace. */
export interface OpenChatTabRequest {
	piSessionId?: string | null;
	title?: string;
	workspaceId: string;
}

export interface OpenChatTabResult {
	tab: ChatTabWire;
}

/**
 * Close a chat tab. Summaries are refreshed by the Pi session lifecycle after
 * agent responses; close only marks `closed_at`. If this is the workspace's
 * final open tab, the handler is a no-op so the min-one-tab invariant holds
 * without creating a replacement.
 */
export interface CloseChatTabRequest {
	chatTabId: string;
}

export interface CloseChatTabResult {
	ok: true;
}

/** Restore a closed chat tab to the end of the workspace's open-tab list. */
export interface RestoreChatTabRequest {
	chatTabId: string;
}

export interface RestoreChatTabResult {
	tab: ChatTabWire | null;
}

/** Attach a Pi session to an already-open tab. */
export interface BindPiSessionToTabRequest {
	chatTabId: string;
	piSessionId: string;
}

export interface BindPiSessionToTabResult {
	ok: true;
}

/** List closed chat tabs for a workspace alongside their persisted summary files. */
export interface ListClosedChatTabsWithSummaryRequest {
	workspaceId: string;
}

export interface ListClosedChatTabsWithSummaryResult {
	entries: readonly ClosedChatTabEntryWire[];
}

/**
 * Chat-tab IPC surface (open / close / restore / bind to Pi session, plus list
 * queries). CHAT-FRAGILE — keep these signatures byte-for-byte identical to
 * the legacy `EnsembleApi` slice; renderer state-machines depend on them.
 */
export interface ChatTabApi {
	bindPiSessionToChatTab: (
		request: BindPiSessionToTabRequest,
	) => Promise<BindPiSessionToTabResult>;
	closeChatTab: (request: CloseChatTabRequest) => Promise<CloseChatTabResult>;
	listChatTabs: (request: ListChatTabsRequest) => Promise<ListChatTabsResult>;
	listClosedChatTabsWithSummary: (
		request: ListClosedChatTabsWithSummaryRequest,
	) => Promise<ListClosedChatTabsWithSummaryResult>;
	openChatTab: (request: OpenChatTabRequest) => Promise<OpenChatTabResult>;
	restoreChatTab: (
		request: RestoreChatTabRequest,
	) => Promise<RestoreChatTabResult>;
}
