import { createFileRoute, Outlet } from '@tanstack/react-router';
import { CommandPalette } from '@/renderer/components/command-palette/command-palette';
import {
	WorkbenchRouteError,
	WorkbenchRouteNotFound,
	WorkbenchRoutePending,
} from '@/renderer/components/workbench-shell/route-boundaries';
import { WORKBENCH_ROUTE_STALE_TIME_MS } from '@/renderer/config/routing';
import { profileRouteLoader } from '@/renderer/lib/instrumentation';
import { loadWorkbenchRouteData } from '@/renderer/routing/workbench-route-loaders';

export const Route = createFileRoute('/_workbench')({
	component: WorkbenchDataLayoutRoute,
	errorComponent: WorkbenchRouteError,
	loader: {
		handler: ({ cause, context, deps, location, params, preload }) =>
			profileRouteLoader(
				{
					cause,
					deps,
					href: location.href,
					params,
					preload,
					routeId: '/_workbench',
					staleReloadMode: 'background',
				},
				() => loadWorkbenchRouteData(context.queryClient),
			),
		staleReloadMode: 'background',
	},
	loaderDeps: () => ({}),
	notFoundComponent: WorkbenchRouteNotFound,
	pendingComponent: WorkbenchRoutePending,
	staleTime: WORKBENCH_ROUTE_STALE_TIME_MS,
});

/** Pathless layout route that fetches workbench data and renders descendants. */
function WorkbenchDataLayoutRoute() {
	return (
		<>
			<Outlet />
			<CommandPalette />
		</>
	);
}
