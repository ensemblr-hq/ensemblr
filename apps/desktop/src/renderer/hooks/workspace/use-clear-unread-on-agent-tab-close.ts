import { useEffect } from 'react';

import { useUnreadChatActions } from '@/renderer/state/unread';

/**
 * Retires the unread mark for a chat an agent closed. Reading a chat is
 * otherwise the only thing that clears one, so an orchestrator tidying up a
 * sub-agent's tab nobody looked at would strand the sidebar dot and leave the
 * jump control aimed at a chat that no longer exists.
 *
 * One global subscription rather than one per workspace: the agent that closes a
 * tab need not be in the workspace on screen, and a mark for a workspace the
 * user is not looking at is exactly the one nothing else can clear. Mounted on
 * the `_workbench` layout rather than the shell inside it, so a close landing
 * while the user is in Settings is still heard — marks are persisted, the
 * broadcast that retires one is not.
 */
export function useClearUnreadOnAgentTabClose(): void {
	const { clearChat } = useUnreadChatActions();

	useEffect(() => {
		const unsubscribe = window.ensemblr?.onAgentControlTabsChanged(
			({ closedChat, workspaceId }) => {
				if (!closedChat) {
					return;
				}
				clearChat({
					agentSessionId: closedChat.agentSessionId,
					chatTabId: closedChat.chatTabId,
					workspaceId,
				});
			},
		);
		return unsubscribe;
	}, [clearChat]);
}
