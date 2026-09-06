import type { UseMutateFunction } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * Cross-instance lock for the workspace-level bootstrap. The route shell owns
 * the only long-lived hook instance, but remounts (StrictMode, route
 * transitions) must not spawn duplicate chat tabs on first load — the first
 * mount to claim the workspace id wins.
 */
const bootstrappedWorkspacesGlobal = new Set<string>();

/**
 * The open request this bootstrap sends. `placeholder` is what tells the main
 * process a spawned conversation may take this tab over; it belongs to this open
 * alone.
 */
const BOOTSTRAP_OPEN_REQUEST = { placeholder: true } as const;

/**
 * Opens a real chat-tab row for a workspace that has none. Placeholder session
 * ids like `<workspaceId>:overview` are not persisted, so the first prompt would
 * fail to bind without a real row.
 *
 * This is the one open nobody asked for, so it is the one open marked
 * `placeholder`: a conversation an agent spawns into this workspace takes this
 * tab rather than stacking a second beside it and leaving one permanently blank.
 * No other open may set the flag — a tab the user opened is theirs from the
 * moment it appears, draft or no draft.
 *
 * Only a settled query is acted on: a mid-refetch snapshot can momentarily read
 * as empty even when tabs exist, and opening on that would spawn a spurious
 * "New chat" and yank the user off their current tab (the 1→2 replace).
 * @param enabled - Whether this hook instance owns the bootstrap
 * @param hasSettledTabList - True once the tab query is neither loading nor refetching
 * @param invalidateChatTabs - Refetches the tab list once the row lands
 * @param onSessionTabChange - Routes to the freshly opened tab
 * @param openChatTab - Persists the new chat-tab row
 * @param openTabCount - How many tabs the settled query reported, or null while unknown
 * @param workspaceId - Workspace being bootstrapped
 */
export function useWorkspaceChatBootstrap({
	enabled,
	hasSettledTabList,
	invalidateChatTabs,
	onSessionTabChange,
	openChatTab,
	openTabCount,
	workspaceId,
}: {
	enabled: boolean;
	hasSettledTabList: boolean;
	invalidateChatTabs: () => void;
	onSessionTabChange: (chatTabId: string) => void;
	openChatTab: UseMutateFunction<
		{ tab?: { id: string } | null },
		Error,
		undefined | Record<string, unknown>,
		unknown
	>;
	openTabCount: number | null;
	workspaceId: string;
}): void {
	useEffect(() => {
		if (!enabled || !hasSettledTabList) {
			return;
		}
		if (openTabCount === null || openTabCount > 0) {
			return;
		}
		if (bootstrappedWorkspacesGlobal.has(workspaceId)) {
			return;
		}
		bootstrappedWorkspacesGlobal.add(workspaceId);
		openChatTab(BOOTSTRAP_OPEN_REQUEST, {
			onError: () => {
				bootstrappedWorkspacesGlobal.delete(workspaceId);
			},
			onSuccess: (result) => {
				if (result.tab) {
					onSessionTabChange(result.tab.id);
				}
				invalidateChatTabs();
			},
		});
	}, [
		enabled,
		hasSettledTabList,
		invalidateChatTabs,
		onSessionTabChange,
		openChatTab,
		openTabCount,
		workspaceId,
	]);
}
