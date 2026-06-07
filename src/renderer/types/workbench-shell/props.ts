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

import type { WorkbenchStaticNavigationTarget } from './navigation';
import type { WorkbenchDockActions, WorkbenchHealth } from './primitives';

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
