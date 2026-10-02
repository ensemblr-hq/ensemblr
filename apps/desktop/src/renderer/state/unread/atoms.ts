import { atomWithStorage } from 'jotai/utils';

/**
 * Most unread marks kept across every workspace, oldest dropped first. Nothing
 * but reading a chat evicts a mark and the list is persisted, so a bound is what
 * stops a long-lived install from growing its stored record without limit.
 */
export const MAX_UNREAD_ENTRIES = 200;

/**
 * One chat tab waiting to be read. `chatTabId` is null when the mark was made
 * for a workspace that was not open: the renderer holds the session-to-tab
 * mapping only for the workspace whose tab list it has loaded, so the jump
 * control resolves that id lazily instead.
 */
export interface UnreadChatEntry {
	agentSessionId: string;
	chatTabId: string | null;
	lastMessageAt: number;
	reason: 'question' | 'turn-finished';
	workspaceId: string;
}

/**
 * Persisted unread chat tabs across every workspace, oldest first, so the last
 * element is the most recent thing the user has not seen. Insertion order is the
 * whole ordering — the timestamps are for display, not for sorting.
 */
export const unreadChatEntriesAtom = atomWithStorage<
	readonly UnreadChatEntry[]
>('ensemblr_unread_chats', [], undefined, { getOnInit: true });
