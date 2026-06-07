import type { WorkbenchActiveView } from '@/renderer/types/workbench-shell';

export interface WorkbenchShellRouteState {
	routeProjectId?: string;
	routeWorkspaceId?: string;
	view: WorkbenchActiveView;
}

export interface WorkbenchChildMatch {
	params: Record<string, unknown>;
	view: unknown;
}
