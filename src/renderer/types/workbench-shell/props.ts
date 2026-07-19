import type {
	AddProjectActionId,
	AddProjectMenuModel,
	ComposerShellState,
	DockTabId,
	ProjectShellModel,
	RecentProject,
	ReviewPanelTab,
	SessionTabModel,
	WorkbenchRouteSearch,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

import type { WorkbenchDockActions, WorkbenchHealth } from './primitives';

export type WorkbenchStaticNavigationTarget =
	| 'dashboard'
	| 'history'
	| 'settings'
	| { kind: 'repo-settings'; repoId: string };

export interface WorkbenchWorkspaceNavigationLinkTarget {
	search: WorkbenchRouteSearch;
	workspace: WorkspaceShellModel;
}

export interface SessionTabState {
	closedSessions: SessionTabModel[];
	closeSessionTab: (sessionId: string) => void;
	effectiveActiveSession: SessionTabModel;
	/** Persists the current left-to-right order of open session tabs. */
	reorderSessionTabs: (sessionIds: string[]) => void;
	restoreSessionTab: (sessionId: string) => void;
	sessionTabs: SessionTabModel[];
}

export interface WorkbenchShellProps {
	activeProject: ProjectShellModel;
	activeReviewTab: ReviewPanelTab;
	activeSession: SessionTabModel;
	activeView:
		| 'dashboard'
		| 'history'
		| 'linear'
		| 'settings'
		| 'welcome'
		| 'workspace';
	activeWorkspace: WorkspaceShellModel;
	addProjectMenu?: AddProjectMenuModel;
	composer: ComposerShellState;
	dockActions: WorkbenchDockActions;
	dockTabId: DockTabId;
	health: WorkbenchHealth;
	onAddProject?: (action: AddProjectActionId) => void;
	onDockTabChange: (tab: DockTabId) => void;
	onOpenRecentProject?: (recent: RecentProject) => void;
	onReviewTabChange: (tab: ReviewPanelTab) => void;
	onSessionTabChange: (sessionId: string) => void;
	onStaticNavigationSelect: (target: WorkbenchStaticNavigationTarget) => void;
	onWorkspaceSelect: (projectId: string, workspaceId: string) => void;
	projects: ProjectShellModel[];
	resolveWorkspaceRouteSearch: (
		workspace: WorkspaceShellModel,
	) => WorkbenchRouteSearch;
}

export type WorkbenchActiveView = WorkbenchShellProps['activeView'];
