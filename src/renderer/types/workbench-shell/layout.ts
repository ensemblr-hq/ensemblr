import type {
	AddProjectActionId,
	AddProjectMenuModel,
	ProjectShellModel,
	WorkbenchRouteSearch,
	WorkspaceNavigationSelection,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

import type { WorkbenchHealth } from './primitives';
import type { WorkbenchStaticNavigationTarget } from './props';

/** Layout model exposed below the `_shell` route. */
export interface WorkbenchLayoutModel {
	activeProject: ProjectShellModel | null;
	activeWorkspace: WorkspaceShellModel | null;
	addProjectMenu: AddProjectMenuModel;
	displayProjects: ProjectShellModel[];
	displaySelection: WorkspaceNavigationSelection | null;
	health: WorkbenchHealth;
	navigateToStaticRoute: (target: WorkbenchStaticNavigationTarget) => void;
	navigateToWorkspace: (
		projectId: string,
		workspaceId: string,
		/** Chat tab to land on, instead of the workspace's remembered one. */
		chatId?: string,
	) => void;
	onAddProject: (id: AddProjectActionId) => void;
	resolveWorkspaceRouteSearch: (
		workspace: WorkspaceShellModel,
	) => WorkbenchRouteSearch;
}
