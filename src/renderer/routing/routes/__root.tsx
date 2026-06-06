import { createRootRouteWithContext } from '@tanstack/react-router';
import { App } from '@/renderer/components/app';
import {
	WorkbenchRouteError,
	WorkbenchRouteNotFound,
	WorkbenchRoutePending,
} from '@/renderer/components/workbench-shell/route-boundaries';
import type { RouterContext } from '@/renderer/types/routing';

export const Route = createRootRouteWithContext<RouterContext>()({
	component: App,
	errorComponent: WorkbenchRouteError,
	notFoundComponent: WorkbenchRouteNotFound,
	pendingComponent: WorkbenchRoutePending,
});
