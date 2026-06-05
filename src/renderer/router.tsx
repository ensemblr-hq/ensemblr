import type { QueryClient } from '@tanstack/react-query';
import {
	createHashHistory,
	createRootRouteWithContext,
	createRoute,
	createRouter,
	Outlet,
} from '@tanstack/react-router';

import { App } from '@/renderer/App';
import { queryClient } from '@/renderer/query-client';
import { normalizeWorkbenchSearch } from '@/renderer/workbench/workbench-model';

interface RouterContext {
	queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
	component: () => <Outlet />,
});

const indexRoute = createRoute({
	component: () => <App view='dashboard' />,
	getParentRoute: () => rootRoute,
	path: '/',
});

const historyRoute = createRoute({
	component: () => <App view='history' />,
	getParentRoute: () => rootRoute,
	path: '/history',
});

const settingsRoute = createRoute({
	component: () => <App view='settings' />,
	getParentRoute: () => rootRoute,
	path: '/settings',
});

const workspaceRoute = createRoute({
	component: WorkspaceRoute,
	getParentRoute: () => rootRoute,
	path: '/projects/$projectId/workspaces/$workspaceId',
	validateSearch: normalizeWorkbenchSearch,
});

const routeTree = rootRoute.addChildren([
	indexRoute,
	historyRoute,
	settingsRoute,
	workspaceRoute,
]);

export const router = createRouter({
	context: {
		queryClient,
	},
	defaultPreload: 'intent',
	history: createHashHistory(),
	routeTree,
});

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router;
	}
}

function WorkspaceRoute() {
	const { projectId, workspaceId } = workspaceRoute.useParams();
	const search = workspaceRoute.useSearch();

	return (
		<App
			projectId={projectId}
			search={search}
			view='workspace'
			workspaceId={workspaceId}
		/>
	);
}
