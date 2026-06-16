import { createHashHistory, createRouter } from '@tanstack/react-router';
import { queryClient } from '@/renderer/api/query-client';
import { installRouteNavigationProfiler } from '@/renderer/lib/instrumentation';
import { routeTree } from './routeTree.gen';
import { installSettingsReturnTracker } from './settings-return-tracker';

/**
 * TanStack Router singleton for the renderer, wired with the shared query
 * client context, intent-based preloading, and hash-history (Electron-friendly).
 */
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
installSettingsReturnTracker(router);

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router;
	}
}
