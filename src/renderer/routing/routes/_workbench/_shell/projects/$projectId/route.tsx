import { createFileRoute, Outlet } from '@tanstack/react-router';
import { loadProjectWorkbenchRoute } from '@/renderer/routing/workbench-route-loaders';

export const Route = createFileRoute('/_workbench/_shell/projects/$projectId')({
	component: ProjectLayoutRoute,
	loader: ({ context, params, parentMatchPromise }) =>
		loadProjectWorkbenchRoute({
			parentMatchPromise,
			params,
			queryClient: context.queryClient,
		}),
});

/** Layout route under `/projects/$projectId` — renders workspace descendants. */
function ProjectLayoutRoute() {
	return <Outlet />;
}
