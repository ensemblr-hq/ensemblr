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
	metadata: Record<string, unknown>;
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

/** Result of listing a workspace's chat tabs: its open and closed tabs. */
export interface ListChatTabsResult {
	closed: readonly ChatTabWire[];
	open: readonly ChatTabWire[];
}

/**
 * Open a new tab in a workspace. `kind` defaults to `'chat'`; non-chat kinds
 * (file/diff/document/preview) carry their subject in `metadata` (e.g.
 * `{ filePath }`) and re-focus an already-open tab for the same subject.
 */
export interface OpenChatTabRequest {
	kind?: ChatTabKindWire;
	metadata?: Record<string, unknown>;
	piSessionId?: string | null;
	title?: string;
	workspaceId: string;
}

/** Result of opening a chat tab: the newly created tab row. */
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
	/**
	 * Final title to stamp on a terminal (harness) tab as it is archived, so the
	 * closed-history row shows the conversation title rather than the harness
	 * label. Ignored for chat tabs, whose title is owned by the Pi session.
	 */
	title?: string;
	/**
	 * Metadata fields to merge onto a terminal (harness) tab as it is archived, so
	 * a restored tab can reattach the exact conversation. Ignored for chat tabs.
	 */
	metadataPatch?: { agentSessionId?: string | null };
}

/** Result of closing a chat tab. */
export interface CloseChatTabResult {
	ok: true;
	/**
	 * True when the close hard-deleted the tab (empty chat or non-chat kind);
	 * false when the tab was archived as restorable or the close was a no-op.
	 * The renderer drops per-chat preference keys only for deleted tabs, since a
	 * restorable tab must keep its model/thinking overrides.
	 */
	deleted: boolean;
}

/** Restore a closed chat tab to the end of the workspace's open-tab list. */
export interface RestoreChatTabRequest {
	chatTabId: string;
}

/** Result of restoring a closed chat tab: the restored tab, or null when nothing was restored. */
export interface RestoreChatTabResult {
	tab: ChatTabWire | null;
}

/** Persist the left-to-right order of every open tab in a workspace. */
export interface ReorderChatTabsRequest {
	orderedIds: readonly string[];
	workspaceId: string;
}

/** Result of reordering a workspace's open tabs in their new persisted order. */
export interface ReorderChatTabsResult {
	open: readonly ChatTabWire[];
}

/** Attach a Pi session to an already-open tab. */
export interface BindPiSessionToTabRequest {
	chatTabId: string;
	piSessionId: string;
}

/** Result of binding a Pi session to an open chat tab. */
export interface BindPiSessionToTabResult {
	ok: true;
}

/** List closed chat tabs for a workspace alongside their persisted summary files. */
export interface ListClosedChatTabsWithSummaryRequest {
	workspaceId: string;
}

/** Result of listing a workspace's closed chat tabs with their persisted session summaries. */
export interface ListClosedChatTabsWithSummaryResult {
	entries: readonly ClosedChatTabEntryWire[];
}

/**
 * Chat-tab IPC surface (open / close / restore / bind to Pi session, plus list
 * queries). CHAT-FRAGILE — keep these signatures byte-for-byte identical to
 * the legacy `EnsemblrApi` slice; renderer state-machines depend on them.
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
	reorderChatTabs: (
		request: ReorderChatTabsRequest,
	) => Promise<ReorderChatTabsResult>;
	restoreChatTab: (
		request: RestoreChatTabRequest,
	) => Promise<RestoreChatTabResult>;
}
