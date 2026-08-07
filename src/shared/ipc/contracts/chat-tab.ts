/**
 * Wire contracts for chat-tab IPC. Mirrors the renderer-facing shape of
 * `chat_tabs` rows so the renderer never depends on storage internals.
 */
import type { ChatTabKindWire } from './agent-session.ts';

/** Renderer-facing snapshot of a chat-tab row. */
export interface ChatTabWire {
	agentSessionId: string | null;
	closedAt: string | null;
	/**
	 * Untruncated title. `title` is capped for tab display, so this is what a
	 * tooltip should show. Equals `title` when no longer form was ever recorded.
	 */
	fullTitle: string;
	id: string;
	/**
	 * True while this tab holds the workspace's single ephemeral preview slot.
	 * Derived in the main process, which owns where the marker is stored, so the
	 * renderer never reads the marker out of {@link ChatTabWire.metadata}.
	 */
	isPreview: boolean;
	kind: ChatTabKindWire;
	metadata: Record<string, unknown>;
	openedAt: string;
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
	agentSessionId?: string | null;
	/**
	 * Open tab the new tab is placed directly to the right of, used by tabs opened
	 * from inside a conversation (file, diff, comment, terminal) so they appear
	 * next to their origin. Omitted by the tab strip's new-chat button, which
	 * appends to the end of the strip.
	 */
	insertAfterChatTabId?: string | null;
	kind?: ChatTabKindWire;
	metadata?: Record<string, unknown>;
	/**
	 * Opens the tab as the workspace's single ephemeral preview slot: the next
	 * preview open retargets this same tab instead of adding another one, until
	 * {@link PinChatTabRequest} makes it permanent. Ignored for chat and terminal
	 * kinds, which own a session and are never ephemeral.
	 */
	preview?: boolean;
	title?: string;
	workspaceId: string;
}

/** Result of opening a chat tab: the newly created tab row. */
export interface OpenChatTabResult {
	tab: ChatTabWire;
}

/**
 * Close a chat tab. Summaries are refreshed by the agent session lifecycle after
 * agent responses; close only marks `closed_at`. If this is the workspace's
 * final open tab, the handler is a no-op so the min-one-tab invariant holds
 * without creating a replacement.
 */
export interface CloseChatTabRequest {
	chatTabId: string;
	/**
	 * Final title to stamp on a terminal (harness) tab as it is archived, so the
	 * closed-history row shows the conversation title rather than the harness
	 * label. Ignored for chat tabs, whose title is owned by the agent session.
	 */
	title?: string;
	/**
	 * Untruncated form of {@link CloseChatTabRequest.title}, kept for the closed
	 * row's tooltip. Falls back to `title` when the caller has nothing longer.
	 */
	fullTitle?: string;
	/**
	 * Metadata fields to merge onto a terminal (harness) tab as it is archived, so
	 * a restored tab can reattach the exact conversation. `harnessSessionId` is the
	 * harness CLI's native session id, not the tab's Ensemblr `agentSessionId`.
	 * Ignored for chat tabs.
	 */
	metadataPatch?: { harnessSessionId?: string | null };
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

/**
 * Promote an ephemeral preview tab to a permanent one, so later preview opens
 * take a fresh slot rather than retargeting it.
 */
export interface PinChatTabRequest {
	chatTabId: string;
}

/** Result of pinning a tab: the pinned tab, or null when no row matched. */
export interface PinChatTabResult {
	tab: ChatTabWire | null;
}

/** Attach an agent session to an already-open tab. */
export interface BindAgentSessionToTabRequest {
	agentSessionId: string;
	chatTabId: string;
}

/** Result of binding an agent session to an open chat tab. */
export interface BindAgentSessionToTabResult {
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
 * Chat-tab IPC surface (open / close / restore / bind to agent session, plus list
 * queries). CHAT-FRAGILE — keep these signatures byte-for-byte identical to
 * the legacy `EnsemblrApi` slice; renderer state-machines depend on them.
 */
export interface ChatTabApi {
	bindAgentSessionToChatTab: (
		request: BindAgentSessionToTabRequest,
	) => Promise<BindAgentSessionToTabResult>;
	closeChatTab: (request: CloseChatTabRequest) => Promise<CloseChatTabResult>;
	listChatTabs: (request: ListChatTabsRequest) => Promise<ListChatTabsResult>;
	listClosedChatTabsWithSummary: (
		request: ListClosedChatTabsWithSummaryRequest,
	) => Promise<ListClosedChatTabsWithSummaryResult>;
	openChatTab: (request: OpenChatTabRequest) => Promise<OpenChatTabResult>;
	pinChatTab: (request: PinChatTabRequest) => Promise<PinChatTabResult>;
	reorderChatTabs: (
		request: ReorderChatTabsRequest,
	) => Promise<ReorderChatTabsResult>;
	restoreChatTab: (
		request: RestoreChatTabRequest,
	) => Promise<RestoreChatTabResult>;
}
