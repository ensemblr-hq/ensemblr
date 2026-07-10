import { createFileRoute, Outlet } from '@tanstack/react-router';
import { loadProjectWorkbenchRoute } from '@/renderer/routing/workbench-route-loaders';

/**
 * Layout route for a project; loads project-scoped workbench data keyed by the
 * `projectId` route param and renders its workspace descendants.
 */
export const Route = createFileRoute('/_workbench/_shell/projects/$projectId')({
	component: ProjectLayoutRoute,
	/** Loads project workbench data for the `projectId` param, chaining off the parent match. */
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
