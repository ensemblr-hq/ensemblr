import { createFileRoute, Outlet } from '@tanstack/react-router';
import { loadProjectWorkbenchRoute } from '@/renderer/routing/workbench-route-loaders';

export const Route = createFileRoute('/_workbench/_shell/projects/$projectId')({
	component: ProjectLayoutRoute,
	loader: ({ params, parentMatchPromise }) =>
		loadProjectWorkbenchRoute({ parentMatchPromise, params }),
});

function ProjectLayoutRoute() {
	return <Outlet />;
}
