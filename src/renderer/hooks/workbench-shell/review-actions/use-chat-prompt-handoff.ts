import { useCallback } from 'react';

import { useComposerSubmit } from '@/renderer/state/composer';
import type { SessionTabModel } from '@/renderer/types/workbench';

import { useChatTabTarget } from './use-chat-tab-target';

/**
 * Builds the handler review surfaces use to hand a ready-made prompt to the
 * workspace's chat agent, queueing it for the tab {@link useChatTabTarget}
 * resolves and following it there.
 * @param input - The tab in front, the workspace's open tabs, and the chat selector
 * @returns Callback taking the prompt, returning false when no chat tab can take it
 */
export function useChatPromptHandoff({
	activeSession,
	selectChat,
	sessionTabs,
	workspaceId,
}: {
	activeSession: SessionTabModel;
	selectChat: (chatTabId: string) => void;
	sessionTabs: readonly SessionTabModel[];
	workspaceId: string;
}): (text: string) => boolean {
	const submitToComposer = useComposerSubmit();
	const deliverToChat = useChatTabTarget({
		activeSession,
		selectChat,
		sessionTabs,
		workspaceId,
	});
	return useCallback(
		(text: string) =>
			deliverToChat((chatTabId) => {
				submitToComposer({ chatTabId, text });
			}),
		[deliverToChat, submitToComposer],
	);
}
