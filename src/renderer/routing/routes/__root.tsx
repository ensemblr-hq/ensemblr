import { createRootRouteWithContext } from '@tanstack/react-router';
import { App } from '@/renderer/components/app';
import {
	WorkbenchRouteError,
	WorkbenchRouteNotFound,
	WorkbenchRoutePending,
} from '@/renderer/components/workbench-shell/route-boundaries';
import type { RouterContext } from '@/renderer/types/routing';

/**
 * Root route for the renderer; supplies the shared router context and renders
 * the app shell with the workbench error, not-found, and pending boundaries.
 */
export const Route = createRootRouteWithContext<RouterContext>()({
	component: App,
	errorComponent: WorkbenchRouteError,
	notFoundComponent: WorkbenchRouteNotFound,
	pendingComponent: WorkbenchRoutePending,
});
