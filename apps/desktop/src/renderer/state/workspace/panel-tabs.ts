import { useAtom, useSetAtom } from 'jotai';
import { useCallback, useEffect } from 'react';
import {
	DEFAULT_DOCK_TAB,
	DEFAULT_REVIEW_TAB,
	getPreferredSession,
	isTerminalDockTabId,
} from '@/renderer/lib/workbench';
import type {
	DockTabId,
	ReviewPanelTab,
	WorkbenchRouteSearch,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import {
	activeDockTabByWorkspaceAtom,
	activeReviewTabByWorkspaceAtom,
	dockVisitOrderByWorkspaceAtom,
} from './layout-atoms';
import {
	activeChatTabByWorkspaceAtom,
	sessionVisitOrderByWorkspaceAtom,
} from './selection-atoms';
import { recordTabVisit, selectPreviouslyVisitedTab } from './tab-visit-order';

/** Per-workspace review-panel tab preferences, keyed by workspace id. */
type ReviewTabPreferences = Record<string, unknown>;
/** Per-workspace dock tab preferences, keyed by workspace id. */
type DockTabPreferences = Record<string, unknown>;
/** Per-workspace chat tab preferences, keyed by workspace id. */
type ChatTabPreferences = Record<string, unknown>;

/**
 * React hook that resolves the active review/dock/chat tab for the current
 * workspace from URL search params plus persisted per-workspace preferences.
 *
 * `activeChatId` accepts null so callers can hand over an id that has not
 * resolved to one of this workspace's tabs yet: the chat memory is left as it
 * is rather than overwritten with a substitute.
 * @param input - Active workspace, optional chat id, and URL search.
 * @returns The active tab values plus setter callbacks.
 */
export function useWorkspacePanelTabState({
	activeChatId,
	activeWorkspace,
	search,
}: {
	activeChatId?: string | null;
	activeWorkspace: WorkspaceShellModel;
	search?: WorkbenchRouteSearch;
}) {
	const [reviewTabsByWorkspace, setReviewTabsByWorkspace] = useAtom(
		activeReviewTabByWorkspaceAtom,
	);
	const [dockTabsByWorkspace, setDockTabsByWorkspace] = useAtom(
		activeDockTabByWorkspaceAtom,
	);
	const [, setChatTabsByWorkspace] = useAtom(activeChatTabByWorkspaceAtom);
	const [dockVisitsByWorkspace, setDockVisitsByWorkspace] = useAtom(
		dockVisitOrderByWorkspaceAtom,
	);
	const setSessionVisitsByWorkspace = useSetAtom(
		sessionVisitOrderByWorkspaceAtom,
	);
	const activeReviewTab = getPreferredReviewTab({
		reviewTabsByWorkspace,
		routeReviewTab: search?.review,
		workspaceId: activeWorkspace.id,
	});
	const activeDockTab = getPreferredDockTab({
		dockTabsByWorkspace,
		routeDockTab: search?.dock,
		visitOrder: dockVisitsByWorkspace[activeWorkspace.id],
		workspace: activeWorkspace,
	});

	useEffect(() => {
		setReviewTabsByWorkspace((current) =>
			current[activeWorkspace.id] === activeReviewTab
				? current
				: { ...current, [activeWorkspace.id]: activeReviewTab },
		);
	}, [activeReviewTab, activeWorkspace.id, setReviewTabsByWorkspace]);

	useEffect(() => {
		setDockTabsByWorkspace((current) =>
			current[activeWorkspace.id] === activeDockTab
				? current
				: { ...current, [activeWorkspace.id]: activeDockTab },
		);
		setDockVisitsByWorkspace((current) =>
			recordTabVisit(current, {
				tabId: activeDockTab,
				workspaceId: activeWorkspace.id,
			}),
		);
	}, [
		activeDockTab,
		activeWorkspace.id,
		setDockTabsByWorkspace,
		setDockVisitsByWorkspace,
	]);

	useEffect(() => {
		if (!activeChatId) {
			return;
		}

		setChatTabsByWorkspace((current) =>
			current[activeWorkspace.id] === activeChatId
				? current
				: { ...current, [activeWorkspace.id]: activeChatId },
		);
		setSessionVisitsByWorkspace((current) =>
			recordTabVisit(current, {
				tabId: activeChatId,
				workspaceId: activeWorkspace.id,
			}),
		);
	}, [
		activeChatId,
		activeWorkspace.id,
		setChatTabsByWorkspace,
		setSessionVisitsByWorkspace,
	]);

	const getPreferredTabsForWorkspace = useCallback(
		(workspace: WorkspaceShellModel) => ({
			dock: getPreferredDockTab({
				dockTabsByWorkspace,
				workspace,
			}),
			review: getPreferredReviewTab({
				reviewTabsByWorkspace,
				workspaceId: workspace.id,
			}),
		}),
		[dockTabsByWorkspace, reviewTabsByWorkspace],
	);

	const setWorkspaceReviewTab = useCallback(
		(workspaceId: string, reviewTab: ReviewPanelTab) => {
			setReviewTabsByWorkspace((current) =>
				current[workspaceId] === reviewTab
					? current
					: { ...current, [workspaceId]: reviewTab },
			);
		},
		[setReviewTabsByWorkspace],
	);

	const setWorkspaceDockTab = useCallback(
		(workspaceId: string, dockTab: DockTabId) => {
			setDockTabsByWorkspace((current) =>
				current[workspaceId] === dockTab
					? current
					: { ...current, [workspaceId]: dockTab },
			);
		},
		[setDockTabsByWorkspace],
	);

	return {
		activeDockTab,
		activeReviewTab,
		getPreferredTabsForWorkspace,
		setWorkspaceDockTab,
		setWorkspaceReviewTab,
	};
}

/**
 * Picks the review-tab to render, preferring the URL value and falling back to
 * persisted preferences or the canonical default.
 * @param input - Persisted prefs, URL override and workspace id.
 * @returns The chosen review tab.
 */
export function getPreferredReviewTab({
	reviewTabsByWorkspace,
	routeReviewTab,
	workspaceId,
}: {
	reviewTabsByWorkspace: ReviewTabPreferences;
	routeReviewTab?: ReviewPanelTab;
	workspaceId: string;
}) {
	const storedReviewTab = reviewTabsByWorkspace[workspaceId];

	return (
		routeReviewTab ??
		(isReviewTab(storedReviewTab) ? storedReviewTab : DEFAULT_REVIEW_TAB)
	);
}

/**
 * Picks the dock-tab to render, preferring the URL value, then the persisted
 * preference, then the most recently visited tab still open, then the default,
 * then the first available tab on the workspace. The visit fallback is what
 * keeps a closed terminal from dumping the user back on Setup.
 *
 * A `terminal:*` preference the workspace cannot yet corroborate is returned
 * unchanged rather than falling through, for as long as the strip is still
 * loading — see {@link isUnresolvedTerminalTab}. Once it has loaded, a
 * preference matching none of its tabs is a closed terminal and falls through
 * like any other, so nothing holds a dead id indefinitely.
 * @param input - Persisted prefs, URL override, visit history and workspace.
 * @returns The chosen dock tab.
 */
export function getPreferredDockTab({
	dockTabsByWorkspace,
	routeDockTab,
	visitOrder,
	workspace,
}: {
	dockTabsByWorkspace: DockTabPreferences;
	routeDockTab?: DockTabId;
	visitOrder?: readonly DockTabId[];
	workspace: WorkspaceShellModel;
}) {
	const preferredDockTab = routeDockTab ?? dockTabsByWorkspace[workspace.id];

	if (preferredDockTab && hasDockTab(workspace, preferredDockTab)) {
		return preferredDockTab;
	}

	if (isUnresolvedTerminalTab(workspace, preferredDockTab)) {
		return preferredDockTab;
	}

	const visitedDockTab = selectPreviouslyVisitedTab({
		openIds: workspace.dockTabs.map((tab) => tab.id),
		visitOrder: visitOrder ?? [],
	});
	if (visitedDockTab) {
		return visitedDockTab;
	}

	if (hasDockTab(workspace, DEFAULT_DOCK_TAB)) {
		return DEFAULT_DOCK_TAB;
	}

	return workspace.dockTabs[0]?.id ?? DEFAULT_DOCK_TAB;
}

/**
 * Picks the chat tab id to route to, preferring the URL, then the persisted tab
 * id, then the most recently visited tab, then the workspace's placeholder
 * session.
 *
 * The visit fallback covers a workspace that has been visited but whose
 * remembered tab was dropped — an eviction pass, a hand-edited store — where
 * falling straight through to the placeholder would open it on its first tab.
 * Nothing here can check the ids against live tab rows: the caller is a sidebar
 * link or a cross-workspace jump, and the destination's rows are not loaded.
 * `useChatRouteRepair` settles a stale id once they are.
 * @param input - Persisted prefs, URL override, visit history and workspace.
 * @returns The chosen chat tab id.
 */
export function getPreferredChatId({
	chatTabsByWorkspace,
	routeChatId,
	visitOrder,
	workspace,
}: {
	chatTabsByWorkspace: ChatTabPreferences;
	routeChatId?: string;
	visitOrder?: readonly string[];
	workspace: WorkspaceShellModel;
}) {
	const storedChatId = chatTabsByWorkspace[workspace.id];
	const preferredChatId =
		routeChatId ??
		(typeof storedChatId === 'string' ? storedChatId : undefined) ??
		visitOrder?.[0];

	return preferredChatId ?? getPreferredSession(workspace).id;
}

/** Type guard checking the workspace exposes the candidate dock tab. */
function hasDockTab(
	workspace: WorkspaceShellModel,
	dockTab: unknown,
): dockTab is DockTabId {
	return (
		typeof dockTab === 'string' &&
		workspace.dockTabs.some((tab) => tab.id === dockTab)
	);
}

/**
 * Whether a remembered `terminal:*` tab is merely unresolvable rather than gone,
 * so it should be held onto instead of replaced by a fallback. Only the routed
 * workspace's shell model carries live terminal tabs, and even there they arrive
 * one main-process round trip after the workspace mounts — so a terminal
 * preference names no visible tab both while a workspace loads and whenever a
 * link is built for a workspace the user is not on. Falling back in that window
 * is what the caller then persists, discarding the user's own tab before it
 * could ever match.
 *
 * `terminalTabsLoaded` is the only signal that separates the two, and the
 * distinction has to be that signal rather than an empty strip: a workspace with
 * no terminals open is an ordinary steady state, and a dock restore relaunches
 * serially, so "the strip holds some terminal tab" goes true while later ones
 * are still arriving. Once it is loaded, a preference naming none of the tabs is
 * genuinely closed and falls through to the visit fallback, which is what settles
 * the stale preference.
 *
 * So this covers a workspace being opened or switched to within one app run,
 * where main keeps the session ids. A relaunched dock restores under fresh ids,
 * which no remembered preference can match — the hold ends when the strip loads
 * and the visit fallback picks the tab, as it does for a terminal that is gone.
 * @param workspace - The workspace whose dock tabs are in view.
 * @param dockTab - The remembered or routed preference.
 * @returns True when the preference is a terminal tab whose strip has not loaded.
 */
function isUnresolvedTerminalTab(
	workspace: WorkspaceShellModel,
	dockTab: unknown,
): dockTab is DockTabId {
	return isTerminalDockTabId(dockTab) && workspace.terminalTabsLoaded !== true;
}

/** Type guard for review-panel tab enum values. */
function isReviewTab(value: unknown): value is ReviewPanelTab {
	return (
		value === 'agents' ||
		value === 'files' ||
		value === 'changes' ||
		value === 'checks'
	);
}
