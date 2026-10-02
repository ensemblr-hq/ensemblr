import { useQuery } from '@tanstack/react-query';

import { listChatTabsQuery } from '@/renderer/api/ensemblr-queries';
import { countOpenAgentConversations } from '@/renderer/lib/agents/conversation-model';
import type { ListChatTabsResult } from '@/shared/ipc/contracts/chat-tab';

/**
 * Reduces a workspace's chat tabs to how many conversations are open, so the
 * subscriber renders again only when that number moves, not when a tab is
 * renamed or reordered.
 * @param tabs - The workspace's open and closed chat tabs
 * @returns The open conversation count
 */
function selectOpenConversationCount(tabs: ListChatTabsResult): number {
	return countOpenAgentConversations({
		closedTabs: tabs.closed,
		openTabs: tabs.open,
	});
}

/**
 * How many agent conversations a workspace has open, for the Agents tab badge.
 * It reads only the chat-tab list, never the session or live-state data the
 * panel's rows are built from, so an agent's activity never reaches it.
 * @param workspaceId - Workspace whose open conversations to count
 * @returns The open conversation count, zero until the chat tabs load
 */
export function useOpenAgentConversationCount(workspaceId: string): number {
	const { data = 0 } = useQuery({
		...listChatTabsQuery(workspaceId),
		select: selectOpenConversationCount,
	});
	return data;
}
