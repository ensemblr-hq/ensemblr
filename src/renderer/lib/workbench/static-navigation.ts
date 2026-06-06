import type { WorkbenchStaticNavigationTarget } from '@/renderer/types/workbench-shell';

export type WorkbenchStaticRouteTo = '/' | '/help' | '/history' | '/settings';

const staticNavigationRouteByTarget: Record<
	WorkbenchStaticNavigationTarget,
	WorkbenchStaticRouteTo
> = {
	dashboard: '/',
	help: '/help',
	history: '/history',
	settings: '/settings',
};

export function getWorkbenchStaticRoute(
	target: WorkbenchStaticNavigationTarget,
) {
	return staticNavigationRouteByTarget[target];
}
