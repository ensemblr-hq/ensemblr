import { DEFAULT_DOCK_TAB } from '@/renderer/lib/workbench/constants';

export {
	getRenderableNavigationSnapshot,
	mapNavigationSnapshotToProjects,
	mapRepositoriesToProjects,
} from './mappers';
export {
	findWorkspaceNavigationSelection,
	getPreferredSession,
	resolveWorkspaceNavigationRenderState,
	resolveWorkspaceNavigationSelection,
	resolveWorkspaceRouteParams,
} from './selection';
export type {
	StoredWorkspaceSelection,
	WorkspaceNavigationRenderState,
	WorkspaceNavigationSelection,
	WorkspaceRouteParams,
} from './types';

/** Default dock tab used for live workspaces backed by the SQLite navigation. */
export const DEFAULT_LIVE_WORKSPACE_DOCK_TAB = DEFAULT_DOCK_TAB;
