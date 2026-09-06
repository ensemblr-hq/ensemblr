import { useAtomValue } from 'jotai';
import { useEffect, useRef } from 'react';

import type { SessionTabModel } from '@/renderer/types/workbench';

import {
	activeChatTabByWorkspaceAtom,
	sessionVisitOrderByWorkspaceAtom,
} from './selection-atoms';
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

/**
 * Points the URL back at a real tab whenever the routed chat id resolves to none
 * of the workspace's open tabs, so the tab on screen, the tab in the URL, and
 * the tab the workspace remembers can never drift apart.
 *
 * A repair is attempted once per routed id per workspace. The layout above this
 * one re-renders on every router-state notification, including the pending churn
 * a redirect produces, and an effect that re-fires per render is what froze the
 * app the last time this route redirected itself — see `WorkspaceWorkbenchLayout`.
 * The same guard stops a target that itself fails to resolve from bouncing the
 * route between two dead ids.
 *
 * A route carrying no chat id for this workspace is left alone rather than
 * repaired: `useActiveWorkspaceChatId` returns undefined on purpose while a
 * workspace-to-workspace transition is pending, and navigating there would send
 * the user back into the workspace they are leaving.
 * @param input - The routed id, the resolution state, and the replace navigator
 */
export function useChatRouteRepair({
	hasSettledTabList,
	navigateToChat,
	resolvedChatId,
	routedChatId,
	sessionTabs,
	workspaceId,
}: Pick<ChatRouteRepairInput, 'hasSettledTabList' | 'resolvedChatId'> & {
	/** Replaces the current history entry with `chatTabId`'s route. */
	navigateToChat: (chatTabId: string) => void;
	/** The `$chatId` route param, or undefined before one is in the URL. */
	routedChatId: string | undefined;
	/** The workspace's open tabs, in left-to-right strip order. */
	sessionTabs: readonly SessionTabModel[];
	workspaceId: string;
}): void {
	const rememberedChatId = useAtomValue(activeChatTabByWorkspaceAtom)[
		workspaceId
	];
	const visitOrder = useAtomValue(sessionVisitOrderByWorkspaceAtom)[
		workspaceId
	];
	const attemptedRepairKeyRef = useRef<string | null>(null);

	const repairTargetChatId = resolveChatRouteRepair({
		hasSettledTabList,
		openTabIds: sessionTabs.map((tab) => tab.id),
		rememberedChatId,
		resolvedChatId,
		visitOrder,
	});

	useEffect(() => {
		if (!routedChatId || !repairTargetChatId) {
			return;
		}

		const repairKey = [workspaceId, routedChatId].join(' ');

		if (attemptedRepairKeyRef.current === repairKey) {
			return;
		}

		attemptedRepairKeyRef.current = repairKey;
		navigateToChat(repairTargetChatId);
	}, [navigateToChat, repairTargetChatId, routedChatId, workspaceId]);
}
