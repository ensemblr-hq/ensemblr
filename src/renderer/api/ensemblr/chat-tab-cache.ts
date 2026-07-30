import type { QueryClient } from '@tanstack/react-query';
import { reconcileOrderedIds } from '@/renderer/lib/ordered-ids';
import type {
	ChatTabWire,
	ListChatTabsResult,
} from '@/shared/ipc/contracts/chat-tab';

import { ensemblrQueryKeys } from './query-keys';

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
		ensemblrQueryKeys.chatTabs(workspaceId),
		(current) => {
			// Without an existing snapshot, seeding `{ open: [tab] }` would drop any
			// sibling tabs the refetch is about to return. Leave the cache untouched
			// and let the caller's invalidate populate it authoritatively.
			if (!current) {
				return current;
			}

			return {
				closed: current.closed.filter((closedTab) => closedTab.id !== tab.id),
				open: getOpenTabsWithInsertion(current.open, tab),
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
		ensemblrQueryKeys.chatTabs(workspaceId),
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

/** Reorders open tabs optimistically while preserving unknown stale rows at the end. */
export function writeReorderedChatTabsToCache({
	orderedIds,
	queryClient,
	workspaceId,
}: {
	orderedIds: readonly string[];
	queryClient: QueryClient;
	workspaceId: string;
}): void {
	queryClient.setQueryData<ListChatTabsResult>(
		ensemblrQueryKeys.chatTabs(workspaceId),
		(current) => {
			if (!current) {
				return current;
			}

			return {
				...current,
				open: getReorderedOpenTabs(current.open, orderedIds),
			};
		},
	);
}

/**
 * Places an opened tab in the strip, mirroring the main-process insert: siblings
 * from the new tab's position onward shift one slot right so a mid-strip open
 * lands beside its anchor instead of colliding with the neighbour it displaced.
 * A tab already present is a re-focus, not an insert, so nothing shifts.
 * @param openTabs - The currently cached open tabs
 * @param tab - The tab the open mutation returned
 * @returns The open tabs including `tab`, in strip order
 */
function getOpenTabsWithInsertion(
	openTabs: readonly ChatTabWire[],
	tab: ChatTabWire,
): ChatTabWire[] {
	const isRefocus = openTabs.some((openTab) => openTab.id === tab.id);
	const siblings = openTabs.filter((openTab) => openTab.id !== tab.id);
	const displaced = isRefocus
		? siblings
		: siblings.map((sibling) =>
				sibling.position >= tab.position
					? { ...sibling, position: sibling.position + 1 }
					: sibling,
			);
	return [...displaced, tab].sort(compareChatTabsByPosition);
}

/** Orders chat tabs by persisted strip position, then creation timestamp. */
function compareChatTabsByPosition(
	left: ChatTabWire,
	right: ChatTabWire,
): number {
	return (
		left.position - right.position ||
		left.openedAt.localeCompare(right.openedAt)
	);
}

/** Rebuilds the open-tab array in the requested order and rewrites positions. */
function getReorderedOpenTabs(
	openTabs: readonly ChatTabWire[],
	orderedIds: readonly string[],
): ChatTabWire[] {
	const tabsById = new Map(openTabs.map((tab) => [tab.id, tab] as const));
	const reconciledIds = reconcileOrderedIds(
		orderedIds,
		openTabs.map((tab) => tab.id),
	);

	return reconciledIds.map((id, position) => {
		const tab = tabsById.get(id) as ChatTabWire;
		return { ...tab, position };
	});
}
