import { createHashHistory, createRouter } from '@tanstack/react-router';
import { queryClient } from '@/renderer/api/query-client';
import { installRouteNavigationProfiler } from '@/renderer/lib/instrumentation/route-profiler';
import { routeTree } from './routeTree.gen';

export const router = createRouter({
	context: {
		queryClient,
	},
	defaultPreload: 'intent',
	defaultPreloadStaleTime: 30_000,
	defaultStaleReloadMode: 'background',
	history: createHashHistory(),
	routeTree,
});

installRouteNavigationProfiler(router);

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router;
	}
}
