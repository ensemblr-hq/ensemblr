import { useCallback } from 'react';

import { useAgentActionRunner } from '@/renderer/hooks/workbench-shell/review-actions/use-agent-action-runner';
import { useChatPromptHandoff } from '@/renderer/hooks/workbench-shell/review-actions/use-chat-prompt-handoff';
import type {
	AgentActionKind,
	ProjectShellModel,
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

/**
 * The two ways a review surface hands work to the workspace's agent, each
 * clearing the narrow-window rail out of the way of the chat it just started.
 *
 * Both land a prompt in a chat tab in the main content, which the rail sheet is
 * sitting over below the rail's breakpoint — so the button that started the turn
 * has to stop covering it. Merge, push and refresh are deliberately not here:
 * they act on the rail's own header and Checks rather than on a chat, and the
 * rail is where the user watches them land.
 *
 * `dismissRail` is injected rather than read from the layout context so this
 * stays usable from anywhere the openers are composed.
 * @param options - The action runner's inputs, plus the rail dismissal to compose
 * @returns The prompt hand-off and the action runner, both rail-aware
 */
export function useReviewAgentActions({
	activeProject,
	activeSession,
	activeWorkspace,
	dismissRail,
	openSessionTab,
	selectChat,
	sessionTabs,
}: {
	activeProject: ProjectShellModel;
	activeSession: SessionTabModel;
	activeWorkspace: WorkspaceShellModel;
	dismissRail: () => void;
	openSessionTab: () => Promise<{ chatTabId: string } | null>;
	selectChat: (chatTabId: string) => void;
	sessionTabs: readonly SessionTabModel[];
}): {
	handOffToChat: (text: string) => boolean;
	runAgentAction: (action: AgentActionKind) => void;
} {
	const startAgentAction = useAgentActionRunner({
		activeProject,
		activeSession,
		activeWorkspace,
		openSessionTab,
		selectChat,
		sessionTabs,
	});
	const seedChatPrompt = useChatPromptHandoff({
		activeSession,
		selectChat,
		sessionTabs,
		workspaceId: activeWorkspace.id,
	});

	// Unconditional because the runner is fire-and-forget: it returns before the
	// prompt is even written, so there is no outcome here to branch on.
	const runAgentAction = useCallback(
		(action: AgentActionKind) => {
			startAgentAction(action);
			dismissRail();
		},
		[dismissRail, startAgentAction],
	);
	// Synchronous, unlike the runner above, so this one waits to hear the prompt
	// landed: a hand-off that found no chat tab falls back to a toast, and closing
	// the rail would take away the surface the user retries from.
	const handOffToChat = useCallback(
		(text: string) => {
			const handedOff = seedChatPrompt(text);

			if (handedOff) {
				dismissRail();
			}
			return handedOff;
		},
		[dismissRail, seedChatPrompt],
	);

	return { handOffToChat, runAgentAction };
}
