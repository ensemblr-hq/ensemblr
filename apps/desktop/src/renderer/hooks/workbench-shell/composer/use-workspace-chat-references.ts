import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { listChatTabsQuery } from '@/renderer/api/ensemblr-queries';
import { chatTabReference } from '@/renderer/lib/concierge';
import type { ConciergeReference } from '@/shared/concierge-references';
import type { ChatTabWire } from '@/shared/ipc/contracts/chat-tab';

/**
 * The chats of one workspace the composer's `@` menu can point at, open ones
 * first.
 *
 * Scoped to the workspace rather than ranked out of the app-wide listing the
 * Concierge uses: a workbench agent can only be told about a conversation it
 * shares a checkout with, and a chat from another project would name a session
 * whose files it cannot see. The tab the composer itself belongs to is dropped —
 * a chat cannot be handed itself.
 *
 * Reads the same query the tab strip does, so the list is already in cache and
 * scoping costs no extra round trip.
 * @param input - Which workspace to list, its name, and the tab to leave out.
 * @returns The references, open tabs before closed ones.
 */
export function useWorkspaceChatReferences({
	excludeChatTabId,
	workspaceId,
	workspaceName,
}: {
	excludeChatTabId: string | null;
	workspaceId: string;
	workspaceName: string;
}): readonly ConciergeReference[] {
	const { data } = useQuery(listChatTabsQuery(workspaceId));

	return useMemo(
		() => [
			...workspaceChatReferences(
				data?.open ?? [],
				'open',
				workspaceName,
				excludeChatTabId,
			),
			...workspaceChatReferences(
				data?.closed ?? [],
				'closed',
				workspaceName,
				excludeChatTabId,
			),
		],
		[data, excludeChatTabId, workspaceName],
	);
}

/**
 * Maps one half of a workspace's listing to references, dropping the composer's
 * own tab.
 * @param tabs - Chat tabs from one half of the listing.
 * @param state - Whether these tabs are open or closed.
 * @param workspaceName - Name of the workspace holding them.
 * @param excludeChatTabId - The tab to leave out, or null to keep them all.
 * @returns The chat references.
 */
function workspaceChatReferences(
	tabs: readonly ChatTabWire[],
	state: 'closed' | 'open',
	workspaceName: string,
	excludeChatTabId: string | null,
): readonly ConciergeReference[] {
	return tabs.flatMap((tab) => {
		if (tab.id === excludeChatTabId) {
			return [];
		}
		const reference = chatTabReference(tab, state, workspaceName);
		return reference ? [reference] : [];
	});
}
