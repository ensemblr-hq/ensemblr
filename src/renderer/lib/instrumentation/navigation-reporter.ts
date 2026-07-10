import type { AnyRouteMatch, AnyRouter } from '@tanstack/react-router';
import {
	type LoaderProfileRecord,
	type NavigationProfile,
	now,
	preloadsByHref,
	roundMs,
	stableJson,
} from './profiler-store';

/**
 * Emits the dev-console summary for one completed navigation, including loader
 * rows, IPC rows, layout-remount counts and preload state.
 * @param navigation - Completed navigation profile.
 * @param matches - Active route matches at render time.
 */
export function logNavigationProfile(
	navigation: NavigationProfile,
	matches: AnyRouteMatch[],
): void {
	const durationMs = now() - navigation.startedAt;
	const preload = preloadsByHref.get(navigation.toHref);
	const loaderRows = navigation.loaderRecords.map((record) => ({
		route: record.routeId,
		durationMs: roundMs(record.durationMs),
		mode: record.mode,
		cause: record.cause,
		staleReloadMode: record.staleReloadMode,
		preload: record.preload,
		loaderDeps: stableJson(record.deps),
		depsChange: record.depsChange,
	}));
	const ipcRows = navigation.ipcRecords.map((record) => ({
		channel: record.channel,
		durationMs: roundMs(record.durationMs),
		database: record.usesDatabase,
	}));
	const remountSummary = navigation.layoutRecords.length
		? navigation.layoutRecords
				.map((record) => `${record.component}:${record.event}`)
				.join(', ')
		: 'none observed';
	const navigationMode = getNavigationMode(navigation.loaderRecords);

	console.groupCollapsed(
		`[route-profiler] ${navigation.fromHref} -> ${navigation.toHref} (${roundMs(durationMs)}ms)`,
	);
	console.info('navigation', {
		hashChanged: navigation.hashChanged,
		hrefChanged: navigation.hrefChanged,
		mode: navigationMode,
		pathChanged: navigation.pathChanged,
	});
	console.info(
		'route chunks',
		preload
			? `${preload.status} by intent in ${roundMs(preload.durationMs ?? 0)}ms before navigation`
			: navigation.hadIntentPreload
				? 'intent preload was started before navigation'
				: 'no intent preload recorded before navigation; route chunk may load on click',
	);
	console.info('layout remounts', remountSummary);
	console.info(
		'active matches',
		matches.map((match) => ({
			fetchCount: match.fetchCount,
			id: match.id,
			isFetching: match.isFetching,
			loaderDeps: stableJson(match.loaderDeps),
			preload: match.preload,
			routeId: match.routeId,
			status: match.status,
		})),
	);

	if (loaderRows.length) {
		console.table(loaderRows);
	} else {
		console.info('loaders', 'none ran during this transition');
	}

	if (ipcRows.length) {
		console.table(ipcRows);
	} else {
		console.info('ipc/database', 'none observed during this transition');
	}

	console.groupEnd();
}

/**
 * Monkey-patches `router.preloadRoute` so each intent-based preload is recorded
 * for the eventual navigation profile.
 * @param router - Router to patch.
 */
export function patchPreloadRoute(router: AnyRouter): void {
	/** Options accepted by the router's `preloadRoute`. */
	type PreloadRouteOptions = Parameters<AnyRouter['preloadRoute']>[0];
	/** Result returned by the router's `preloadRoute`. */
	type PreloadRouteResult = ReturnType<AnyRouter['preloadRoute']>;

	const originalPreloadRoute = router.preloadRoute.bind(router) as (
		options: PreloadRouteOptions,
	) => PreloadRouteResult;

	/**
	 * Wrapped `preloadRoute` that records start/resolve/fail metadata for each
	 * preload attempt.
	 * @param options - Original preload options.
	 * @returns The result of the underlying `preloadRoute` call.
	 */
	const preloadRouteWithProfile = (
		options: PreloadRouteOptions,
	): PreloadRouteResult => {
		const href = getPreloadHref(router, options);
		const startedAt = now();

		if (href) {
			preloadsByHref.set(href, {
				href,
				startedAt,
				status: 'started',
			});
		}

		const preload = originalPreloadRoute(options);

		void preload
			.then(() => {
				if (!href) {
					return;
				}

				preloadsByHref.set(href, {
					durationMs: now() - startedAt,
					href,
					startedAt,
					status: 'resolved',
				});
			})
			.catch(() => {
				if (!href) {
					return;
				}

				preloadsByHref.set(href, {
					durationMs: now() - startedAt,
					href,
					startedAt,
					status: 'failed',
				});
			});

		return preload;
	};

	router.preloadRoute = preloadRouteWithProfile as AnyRouter['preloadRoute'];
}

/**
 * Resolves the href that a preload call targets, returning `null` when the
 * router cannot build the location.
 * @param router - Router used to resolve the location.
 * @param options - Preload options forwarded to `buildLocation`.
 * @returns The target href, or `null`.
 */
function getPreloadHref(
	router: AnyRouter,
	options: Parameters<AnyRouter['preloadRoute']>[0],
): string | null {
	try {
		return router.buildLocation(
			options as unknown as Parameters<AnyRouter['buildLocation']>[0],
		).href;
	} catch {
		return null;
	}
}

/** Aggregates per-loader modes into one descriptor for the navigation. */
function getNavigationMode(records: LoaderProfileRecord[]) {
	if (!records.length) {
		return 'background/no loader work';
	}

	if (records.some((record) => record.mode === 'blocking')) {
		return 'blocking';
	}

	if (records.some((record) => record.mode === 'background')) {
		return 'background';
	}

	return 'preload';
}
