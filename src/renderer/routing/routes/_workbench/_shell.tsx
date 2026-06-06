import { createFileRoute } from '@tanstack/react-router';
import {
	WorkbenchRouteError,
	WorkbenchRouteNotFound,
	WorkbenchRoutePending,
} from '@/renderer/components/workbench-shell/route-boundaries';
import { WorkbenchShellLayout } from '@/renderer/components/workbench-shell/route-layout';
import { loadShellWorkbenchRoute } from '@/renderer/routing/workbench-route-loaders';

export const Route = createFileRoute('/_workbench/_shell')({
	component: WorkbenchShellLayout,
	errorComponent: WorkbenchRouteError,
	loader: ({ parentMatchPromise }) =>
		loadShellWorkbenchRoute({ parentMatchPromise }),
	notFoundComponent: WorkbenchRouteNotFound,
	pendingComponent: WorkbenchRoutePending,
});
