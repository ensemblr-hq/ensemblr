import type { QueryClient } from '@tanstack/react-query';
import type { ChatTabWire, ListChatTabsResult } from '@/shared/ipc';

import { ensembleQueryKeys } from './query-keys';

/** Writes an opened tab into the query cache before the refetch completes. */
export function writeOpenedChatTabToCache({
	queryClient,
	tab,
	workspaceId,
}: {
	queryClient: QueryClient;
	tab: ChatTabWire;
	workspaceId: string;
}): void {
	queryClient.setQueryData<ListChatTabsResult>(
		ensembleQueryKeys.chatTabs(workspaceId),
		(current) => {
			if (!current) {
				return {
					closed: [],
					open: [tab],
				};
			}

			return {
				closed: current.closed.filter((closedTab) => closedTab.id !== tab.id),
				open: [
					...current.open.filter((openTab) => openTab.id !== tab.id),
					tab,
				].sort(compareChatTabsByPosition),
			};
		},
	);
}

/** Removes a closed tab from the open-tab cache before IPC/refetch completes. */
export function removeOpenChatTabFromCache({
	chatTabId,
	queryClient,
	workspaceId,
}: {
	chatTabId: string;
	queryClient: QueryClient;
	workspaceId: string;
}): void {
	queryClient.setQueryData<ListChatTabsResult>(
		ensembleQueryKeys.chatTabs(workspaceId),
		(current) => {
			if (!current) {
				return current;
			}
			return {
				...current,
				open: current.open.filter((tab) => tab.id !== chatTabId),
			};
		},
	);
}

/** Orders chat tabs by persisted strip position, then creation timestamp. */
export function compareChatTabsByPosition(
	left: ChatTabWire,
	right: ChatTabWire,
): number {
	return (
		left.position - right.position ||
		left.openedAt.localeCompare(right.openedAt)
	);
}
