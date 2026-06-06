import { useAtom } from 'jotai';
import { useCallback, useEffect } from 'react';
import {
	DEFAULT_DOCK_TAB,
	DEFAULT_REVIEW_TAB,
	getPreferredSession,
} from '@/renderer/lib/workbench';
import type {
	DockTabId,
	ReviewPanelTab,
	WorkbenchRouteSearch,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import {
	activeChatTabByWorkspaceAtom,
	activeDockTabByWorkspaceAtom,
	activeReviewTabByWorkspaceAtom,
} from './atoms';

type ReviewTabPreferences = Record<string, unknown>;
type DockTabPreferences = Record<string, unknown>;
type ChatTabPreferences = Record<string, unknown>;

export function useWorkspacePanelTabState({
	activeChatId,
	activeWorkspace,
	search,
}: {
	activeChatId?: string;
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
	const activeReviewTab = getPreferredReviewTab({
		reviewTabsByWorkspace,
		routeReviewTab: search?.review,
		workspaceId: activeWorkspace.id,
	});
	const activeDockTab = getPreferredDockTab({
		dockTabsByWorkspace,
		routeDockTab: search?.dock,
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
	}, [activeDockTab, activeWorkspace.id, setDockTabsByWorkspace]);

	useEffect(() => {
		if (!activeChatId) {
			return;
		}

		setChatTabsByWorkspace((current) =>
			current[activeWorkspace.id] === activeChatId
				? current
				: { ...current, [activeWorkspace.id]: activeChatId },
		);
	}, [activeChatId, activeWorkspace.id, setChatTabsByWorkspace]);

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

export function getPreferredDockTab({
	dockTabsByWorkspace,
	routeDockTab,
	workspace,
}: {
	dockTabsByWorkspace: DockTabPreferences;
	routeDockTab?: DockTabId;
	workspace: WorkspaceShellModel;
}) {
	const preferredDockTab = routeDockTab ?? dockTabsByWorkspace[workspace.id];

	if (preferredDockTab && hasDockTab(workspace, preferredDockTab)) {
		return preferredDockTab;
	}

	if (hasDockTab(workspace, DEFAULT_DOCK_TAB)) {
		return DEFAULT_DOCK_TAB;
	}

	return workspace.dockTabs[0]?.id ?? DEFAULT_DOCK_TAB;
}

export function getPreferredChatId({
	chatTabsByWorkspace,
	routeChatId,
	workspace,
}: {
	chatTabsByWorkspace: ChatTabPreferences;
	routeChatId?: string;
	workspace: WorkspaceShellModel;
}) {
	const storedChatId = chatTabsByWorkspace[workspace.id];
	const preferredChatId =
		routeChatId ??
		(typeof storedChatId === 'string' ? storedChatId : undefined);

	return getPreferredSession(workspace, preferredChatId).id;
}

function hasDockTab(
	workspace: WorkspaceShellModel,
	dockTab: unknown,
): dockTab is DockTabId {
	return (
		typeof dockTab === 'string' &&
		workspace.dockTabs.some((tab) => tab.id === dockTab)
	);
}

function isReviewTab(value: unknown): value is ReviewPanelTab {
	return value === 'files' || value === 'changes' || value === 'checks';
}
