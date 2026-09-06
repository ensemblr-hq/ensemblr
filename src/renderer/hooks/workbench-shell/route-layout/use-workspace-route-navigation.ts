import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useRef } from 'react';

import { useAgentControlFocus } from '@/renderer/hooks/workbench-shell/route-layout/use-agent-control-focus';
import { isDockTab } from '@/renderer/lib/workbench/route-search';
import { useExpandDockPanel } from '@/renderer/state/workspace/terminal-requests';
import type {
	DockTabId,
	ReviewPanelTab,
	WorkbenchRouteSearch,
} from '@/renderer/types/workbench';
import type { FocusViewBroadcast } from '@/shared/agent-control';

/** Every way the workspace screen moves itself between chats and panel tabs. */
export interface WorkspaceRouteNavigation {
	/** Selects a chat tab, keeping the panel tabs the user had open. */
	selectChatTab: (chatTabId: string) => void;
	selectDockTab: (dock: DockTabId) => void;
	selectReviewTab: (review: ReviewPanelTab) => void;
	/** Persists a panel-tab change to local prefs and forwards it to the URL. */
	updateSearch: (nextSearch: WorkbenchRouteSearch) => void;
}

/**
 * Owns how the workspace screen navigates itself: between its chat tabs,
 * between its panel tabs, and in answer to an agent's focus request.
 *
 * Every handler it returns is stable across renders, and that is a rendering
 * constraint rather than a matter of taste. `selectChatTab` reaches the
 * transcript as the turn-diff opener that its message rows are memoized
 * against, so a fresh closure per render re-renders every row — and every
 * popover inside them — whenever anything else on this screen moves.
 * @param input - The routed workspace and chat, the panel tabs in view, and the setters that persist them.
 * @returns The screen's navigation handlers.
 */
export function useWorkspaceRouteNavigation({
	activeChatTabId,
	activeDockTab,
	activeReviewTab,
	projectId,
	setWorkspaceDockTab,
	setWorkspaceReviewTab,
	workspaceId,
}: {
	activeChatTabId: string;
	activeDockTab: DockTabId;
	activeReviewTab: ReviewPanelTab;
	projectId: string;
	setWorkspaceDockTab: (workspaceId: string, dockTab: DockTabId) => void;
	setWorkspaceReviewTab: (
		workspaceId: string,
		reviewTab: ReviewPanelTab,
	) => void;
	workspaceId: string;
}): WorkspaceRouteNavigation {
	const navigate = useNavigate();
	const expandDockPanel = useExpandDockPanel();
	// Two navigations in one tick are routine — revealing a file's directory
	// switches to All files and then selects the preview's tab — and the second
	// one reading this render's value would silently revert the first.
	const latestPanelTabs = useRef({
		dock: activeDockTab,
		review: activeReviewTab,
	});
	useEffect(() => {
		latestPanelTabs.current = { dock: activeDockTab, review: activeReviewTab };
	}, [activeDockTab, activeReviewTab]);

	const navigateToWorkspaceChat = useCallback(
		({
			nextChatId,
			nextSearch,
		}: {
			nextChatId: string;
			nextSearch?: WorkbenchRouteSearch;
		}) => {
			navigate({
				params: { chatId: nextChatId, projectId, workspaceId },
				search: {
					dock: latestPanelTabs.current.dock,
					review: latestPanelTabs.current.review,
					...nextSearch,
				},
				to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
			});
		},
		[navigate, projectId, workspaceId],
	);

	const updateSearch = useCallback(
		(nextSearch: WorkbenchRouteSearch) => {
			latestPanelTabs.current = {
				dock: nextSearch.dock ?? latestPanelTabs.current.dock,
				review: nextSearch.review ?? latestPanelTabs.current.review,
			};
			if (nextSearch.review) {
				setWorkspaceReviewTab(workspaceId, nextSearch.review);
			}
			if (nextSearch.dock) {
				setWorkspaceDockTab(workspaceId, nextSearch.dock);
			}
			navigateToWorkspaceChat({ nextChatId: activeChatTabId, nextSearch });
		},
		[
			activeChatTabId,
			navigateToWorkspaceChat,
			setWorkspaceDockTab,
			setWorkspaceReviewTab,
			workspaceId,
		],
	);

	const selectChatTab = useCallback(
		(chatTabId: string) => navigateToWorkspaceChat({ nextChatId: chatTabId }),
		[navigateToWorkspaceChat],
	);
	const selectDockTab = useCallback(
		(dock: DockTabId) => updateSearch({ dock }),
		[updateSearch],
	);
	const selectReviewTab = useCallback(
		(review: ReviewPanelTab) => updateSearch({ review }),
		[updateSearch],
	);

	/**
	 * Applies an agent-control focus request for the window showing this
	 * workspace, ignoring requests targeting another workspace or carrying a dock
	 * id that is not a valid {@link DockTabId} (the payload is agent-supplied). A
	 * dock request also reveals the terminal area, since selecting a tab behind a
	 * collapsed dock or sidebar shows the user nothing.
	 * @param payload - The focus request broadcast from the main process.
	 */
	const applyFocus = useCallback(
		(payload: FocusViewBroadcast) => {
			if (payload.workspaceId !== workspaceId) {
				return;
			}
			const { target } = payload;
			if (target.kind === 'tab') {
				selectChatTab(target.chatTabId);
				return;
			}
			if (target.kind === 'dock') {
				if (isDockTab(target.dock)) {
					updateSearch({ dock: target.dock });
					expandDockPanel(workspaceId);
				}
				return;
			}
			// `workspace` crosses workspaces by definition, so the shell drains it —
			// see `AgentControlWorkspaceFocusBridge`. Reaching it here would mean the
			// route is already where it asked to be.
			if (target.kind === 'panel') {
				updateSearch({ review: target.panel });
			}
		},
		[expandDockPanel, selectChatTab, updateSearch, workspaceId],
	);
	useAgentControlFocus(applyFocus);

	return { selectChatTab, selectDockTab, selectReviewTab, updateSearch };
}
