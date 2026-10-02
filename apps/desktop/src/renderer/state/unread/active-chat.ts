import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect } from 'react';

import { reportActiveChat } from '@/renderer/api/ensemblr';

import { unreadChatEntriesAtom } from './atoms';
import { isChatUnread } from './entries';
import { useUnreadChatActions } from './hooks';

/** The chat the user is looking at right now, or null when none is open. */
export interface ActiveChatIdentity {
	agentSessionId: string | null;
	chatTabId: string;
	workspaceId: string;
}

/**
 * The chat currently on screen, published by the open workspace so the global
 * unread subscription can tell a turn the user is watching from one they are
 * not. In-memory: a fresh run has no chat open until a route resolves.
 */
export const activeChatIdentityAtom = atom<ActiveChatIdentity | null>(null);

/**
 * The chat on screen while a mark is still held for it, and null otherwise.
 *
 * A mark can land for the chat the user is already reading, because the two
 * sides are keyed on different clocks: the identity carries the session id the
 * tab list has resolved, while a turn arrives carrying the one the runtime is
 * actually running. Whenever the tab list is behind — first paint of a
 * workspace, a tab an agent just opened, a chat whose runtime was resumed — the
 * on-screen check misses and the chat in front of the user is marked.
 *
 * Deriving the stale mark rather than clearing on a change of identity is what
 * makes that self-correcting: the answer is recomputed on every change to
 * either side, so the mark goes as soon as the two agree, instead of sitting on
 * the composer's jump control until the user navigates away and back.
 */
const staleActiveChatMarkAtom = atom<ActiveChatIdentity | null>((get) => {
	const activeChat = get(activeChatIdentityAtom);
	if (!activeChat) {
		return null;
	}
	return isChatUnread(get(unreadChatEntriesAtom), activeChat)
		? activeChat
		: null;
});

/**
 * Publishes the open chat's identity and clears its unread mark, which is what
 * makes viewing a tab the only thing that marks it read. The same identity goes
 * to the main process, where the desktop notifier needs it to tell the chat the
 * user is watching from the one that just finished in the background.
 *
 * Only the routed workspace mounts this, so the atom holds at most one entry.
 * The teardown is its own effect so switching tabs never blanks the identity
 * between two commits, which would let a turn landing in that gap mark the tab
 * the user is staring at.
 *
 * The clear is driven by {@link staleActiveChatMarkAtom} rather than run inline
 * with the publish, so a mark that lands *after* the identity settled is
 * retired too — see that atom for why one can.
 * @param agentSessionId - Session backing the open chat, or null when it has none
 * @param chatTabId - The open chat tab
 * @param workspaceId - Workspace the chat belongs to
 */
export function usePublishActiveChat({
	agentSessionId,
	chatTabId,
	workspaceId,
}: {
	agentSessionId: string | null;
	chatTabId: string;
	workspaceId: string;
}): void {
	const setActiveChat = useSetAtom(activeChatIdentityAtom);
	const { clearChat } = useUnreadChatActions();
	const staleMark = useAtomValue(staleActiveChatMarkAtom);

	useEffect(() => {
		setActiveChat({ agentSessionId, chatTabId, workspaceId });
		reportActiveChat({ agentSessionId, chatTabId, workspaceId });
	}, [agentSessionId, chatTabId, setActiveChat, workspaceId]);

	useEffect(() => {
		if (staleMark) {
			clearChat(staleMark);
		}
	}, [clearChat, staleMark]);

	useEffect(
		() => () => {
			setActiveChat(null);
			reportActiveChat(null);
		},
		[setActiveChat],
	);
}
