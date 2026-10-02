import { useAtomCallback } from 'jotai/utils';
import { useCallback } from 'react';

import { resolveTargetChatTabId } from '@/renderer/lib/workbench/chat-tab-target';
import { sessionVisitOrderByWorkspaceAtom } from '@/renderer/state/workspace';
import type { SessionTabModel } from '@/renderer/types/workbench';

/**
 * Builds the one way a review surface reaches the workspace's chat agent:
 * resolve the tab that can take the prompt, hand it over, and bring that tab
 * forward when something else is in front.
 *
 * Bringing the tab forward is part of the delivery, not a courtesy. Both the
 * composer queue and the primed-action slot are drained by the tab in front, so
 * a chore raised from the Checks panel over a diff viewer would otherwise wait,
 * unseen, until the user happened to click back into that chat.
 *
 * The two callers — a queued prompt and a primed agent action — differ only in
 * what they do with the resolved id, so that is all `deliver` carries. Keeping
 * the resolve-and-navigate half here is what stops the two from drifting on
 * which tab they pick.
 * @param input - The tab in front, the workspace's open tabs, and the chat selector
 * @returns Callback taking what to do with the target, returning whether one was found
 */
export function useChatTabTarget({
	activeSession,
	selectChat,
	sessionTabs,
	workspaceId,
}: {
	activeSession: SessionTabModel;
	selectChat: (chatTabId: string) => void;
	sessionTabs: readonly SessionTabModel[];
	workspaceId: string;
}): (deliver: (chatTabId: string) => void) => boolean {
	const readVisitOrder = useAtomCallback(
		useCallback(
			(get) => get(sessionVisitOrderByWorkspaceAtom)[workspaceId],
			[workspaceId],
		),
	);
	return useCallback(
		(deliver: (chatTabId: string) => void) => {
			const chatTabId = resolveTargetChatTabId({
				activeSession,
				sessionTabs,
				visitOrder: readVisitOrder(),
			});
			if (!chatTabId) {
				return false;
			}
			deliver(chatTabId);
			if (chatTabId !== activeSession.chatTabId) {
				selectChat(chatTabId);
			}
			return true;
		},
		[activeSession, readVisitOrder, selectChat, sessionTabs],
	);
}
