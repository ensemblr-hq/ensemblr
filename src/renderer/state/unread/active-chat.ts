import { atom, useSetAtom } from 'jotai';
import { useEffect } from 'react';

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
 * Publishes the open chat's identity and clears its unread mark, which is what
 * makes viewing a tab the only thing that marks it read.
 *
 * Only the routed workspace mounts this, so the atom holds at most one entry.
 * The teardown is its own effect so switching tabs never blanks the identity
 * between two commits, which would let a turn landing in that gap mark the tab
 * the user is staring at.
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

	useEffect(() => {
		setActiveChat({ agentSessionId, chatTabId, workspaceId });
		clearChat({ agentSessionId, chatTabId, workspaceId });
	}, [agentSessionId, chatTabId, clearChat, setActiveChat, workspaceId]);

	useEffect(() => () => setActiveChat(null), [setActiveChat]);
}
