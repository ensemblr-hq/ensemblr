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

/**
 * Maps a workbench navigation target to its TanStack Router `to` value.
 * @param target - Static target enum value.
 * @returns A typed router `to` path.
 */
export function getWorkbenchStaticRoute(
	target: WorkbenchStaticNavigationTarget,
) {
	return staticNavigationRouteByTarget[target];
}
