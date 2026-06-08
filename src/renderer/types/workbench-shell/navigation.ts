import type {
	WorkbenchRouteSearch,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

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
