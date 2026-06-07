import type {
	WorkbenchRouteSearch,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

export type WorkbenchStaticNavigationTarget =
	| 'dashboard'
	| 'help'
	| 'history'
	| 'settings';

export interface WorkbenchWorkspaceNavigationLinkTarget {
	search: WorkbenchRouteSearch;
	workspace: WorkspaceShellModel;
}
