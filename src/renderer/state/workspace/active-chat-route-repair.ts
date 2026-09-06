import { selectPreviouslyVisitedTab } from './tab-visit-order';

/** Route resolution state a repair decision is made from. */
interface ChatRouteRepairInput {
	/** True once the tab query has settled, so an unresolved id is really gone. */
	hasSettledTabList: boolean;
	/** Open tab ids in left-to-right strip order. */
	openTabIds: readonly string[];
	/** The tab this workspace remembers being on, when one is stored. */
	rememberedChatId?: string | null;
	/** The routed tab id once confirmed open, or null when it resolves to nothing. */
	resolvedChatId: string | null;
	/** The workspace's visit order, most recent first. */
	visitOrder?: readonly string[];
}

/**
 * Picks the tab a workspace should be routed to when its `$chatId` names no open
 * tab of that workspace, or null when the route needs no repair.
 *
 * An unresolvable id is routine rather than exceptional: the loaders redirect to
 * the synthetic `<workspaceId>:overview` placeholder, an agent or a second
 * window can close the routed tab, and a remembered tab can be closed while the
 * workspace is off screen. The shell renders the first tab in every one of those
 * cases, which is why closing a tab used to dump the user at the start of the
 * strip — and because the URL kept the dead id, nothing recorded the tab the
 * user was actually looking at, so the visit chain stopped growing too.
 *
 * Preference order is the one the user experiences everywhere else: the tab they
 * were on most recently and that is still open, then the workspace's remembered
 * tab, then the head of the strip as a last resort.
 *
 * `useChatRouteRepair` is what acts on this; the decision lives here so it can
 * be reasoned about without a router.
 * @param input - Route resolution state, the open tabs, and the two memories
 * @returns The tab id to route to, or null when the route is already correct
 */
export function resolveChatRouteRepair({
	hasSettledTabList,
	openTabIds,
	rememberedChatId,
	resolvedChatId,
	visitOrder,
}: ChatRouteRepairInput): string | null {
	if (resolvedChatId !== null || !hasSettledTabList) {
		return null;
	}

	const visitedTabId = selectPreviouslyVisitedTab({
		openIds: openTabIds,
		visitOrder: visitOrder ?? [],
	});

	if (visitedTabId) {
		return visitedTabId;
	}

	if (rememberedChatId && openTabIds.includes(rememberedChatId)) {
		return rememberedChatId;
	}

	return openTabIds[0] ?? null;
}
