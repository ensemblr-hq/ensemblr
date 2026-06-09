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
	| 'help'
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
	restoreSessionTab: (sessionId: string) => void;
	sessionTabs: SessionTabModel[];
}

/**
 * Extended session-tab state surface — adds async open/close handlers used by
 * the conversation-panel SessionTabs to drive routing on mutation success.
 */
export interface SessionTabActions {
	openSessionTab: () => Promise<{ chatTabId: string } | null>;
	closeSessionTabAsync: (
		chatTabId: string,
	) => Promise<{ replacementChatTabId: string | null }>;
}

export interface WorkbenchShellProps {
	activeProject: ProjectShellModel;
	activeReviewTab: ReviewPanelTab;
	activeSession: SessionTabModel;
	activeView:
		| 'dashboard'
		| 'help'
		| 'history'
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
