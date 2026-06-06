import { createFileRoute } from '@tanstack/react-router';
import { WorkspaceWorkbenchLayout } from '@/renderer/components/workbench-shell/route-layout';
import { WORKSPACE_ROUTE_STALE_TIME_MS } from '@/renderer/config/routing';
import { profileRouteLoader } from '@/renderer/lib/instrumentation/route-profiler';
import { normalizeWorkbenchSearch } from '@/renderer/lib/workbench';
import { loadWorkspaceWorkbenchRoute } from '@/renderer/routing/workbench-route-loaders';

export const Route = createFileRoute(
	'/_workbench/_shell/projects/$projectId/workspaces/$workspaceId',
)({
	component: WorkspaceWorkbenchLayout,
	loader: {
		handler: ({ cause, deps, location, params, parentMatchPromise, preload }) =>
			profileRouteLoader(
				{
					cause,
					deps,
					href: location.href,
					params,
					preload,
					routeId:
						'/_workbench/_shell/projects/$projectId/workspaces/$workspaceId',
					staleReloadMode: 'background',
				},
				() =>
					loadWorkspaceWorkbenchRoute({
						parentMatchPromise,
						params,
						rawSearch: location.search,
						search: deps,
					}),
			),
		staleReloadMode: 'background',
	},
	loaderDeps: ({ search }) => ({
		dock: search.dock,
		review: search.review,
	}),
	staleTime: WORKSPACE_ROUTE_STALE_TIME_MS,
	staticData: {
		workbenchView: 'workspace',
	},
	validateSearch: normalizeWorkbenchSearch,
});
