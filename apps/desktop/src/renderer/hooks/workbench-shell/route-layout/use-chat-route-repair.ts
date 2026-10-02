import { useNavigate } from '@tanstack/react-router';
import { useAtomValue } from 'jotai';
import { useEffect, useRef } from 'react';

import {
	activeChatTabByWorkspaceAtom,
	resolveChatRouteRepair,
	sessionVisitOrderByWorkspaceAtom,
} from '@/renderer/state/workspace';
import type {
	SessionTabModel,
	WorkbenchRouteSearch,
} from '@/renderer/types/workbench';

/**
 * Points the URL back at a real tab whenever the routed chat id resolves to none
 * of the workspace's open tabs, so the tab on screen, the tab in the URL, and
 * the tab the workspace remembers can never drift apart. `resolveChatRouteRepair`
 * chooses the target; this owns the navigation.
 *
 * A repair is attempted once per routed id per workspace. The workspace layout
 * re-renders on every router-state notification, including the pending churn a
 * redirect produces, and an effect that re-fires per render is what froze the app
 * the last time this route redirected itself — see `WorkspaceWorkbenchLayout`.
 * The same guard stops a target that itself fails to resolve from bouncing the
 * route between two dead ids.
 *
 * A route carrying no chat id for this workspace is left alone rather than
 * repaired: `useActiveWorkspaceChatId` returns undefined on purpose while a
 * workspace-to-workspace transition is pending, and navigating there would send
 * the user back into the workspace they are leaving.
 * @param input - The routed identity, the tab resolution state, and the URL search to preserve
 */
export function useChatRouteRepair({
	hasSettledTabList,
	projectId,
	resolvedChatId,
	routedChatId,
	search,
	sessionTabs,
	workspaceId,
}: {
	/** True once the tab query has settled, so an unresolved id is really gone. */
	hasSettledTabList: boolean;
	projectId: string;
	/** The routed tab id once confirmed open, or null when it resolves to nothing. */
	resolvedChatId: string | null;
	/** The `$chatId` route param, or undefined before one is in the URL. */
	routedChatId: string | undefined;
	/** URL search carried across the repair, so the dock and review panes hold. */
	search: WorkbenchRouteSearch;
	/** The workspace's open tabs, in left-to-right strip order. */
	sessionTabs: readonly SessionTabModel[];
	workspaceId: string;
}): void {
	const navigate = useNavigate();
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
		navigate({
			params: { chatId: repairTargetChatId, projectId, workspaceId },
			replace: true,
			search,
			to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
		});
	}, [
		navigate,
		projectId,
		repairTargetChatId,
		routedChatId,
		search,
		workspaceId,
	]);
}
