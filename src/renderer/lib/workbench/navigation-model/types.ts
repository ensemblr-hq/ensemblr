import type {
	ProjectShellModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

/** Identifies the active project/workspace and how it was chosen. */
export interface WorkspaceNavigationSelection {
	project: ProjectShellModel;
	source: 'first' | 'route' | 'stored';
	workspace: WorkspaceShellModel;
}

/** Persisted last-known workspace selection. */
export interface StoredWorkspaceSelection {
	projectId: string;
	workspaceId: string;
}

/** Render-time projection of the workspace navigation state. */
export interface WorkspaceNavigationRenderState {
	projects: ProjectShellModel[];
	selection: WorkspaceNavigationSelection;
	source: 'current' | 'previous';
}

/** Route params for a fully-resolved workspace navigation target. */
export interface WorkspaceRouteParams {
	chatId: string;
	projectId: string;
	workspaceId: string;
}
