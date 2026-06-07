import type {
	AnyRouteMatch,
	AnyRouter,
	ParsedLocation,
} from '@tanstack/react-router';
import { useEffect, useLayoutEffect } from 'react';

type LoaderCause = 'enter' | 'preload' | 'stay';
type LoaderStaleReloadMode = 'background' | 'blocking';

interface RouteInputSnapshot {
	deps: unknown;
	params?: Record<string, unknown>;
}

interface LoaderProfileMetadata {
	cause: LoaderCause;
	deps: unknown;
	href: string;
	params?: Record<string, unknown>;
	preload: boolean;
	routeId: string;
	staleReloadMode: LoaderStaleReloadMode;
}

interface LoaderProfileRecord extends LoaderProfileMetadata {
	depsChange: string;
	durationMs: number;
	mode: 'background' | 'blocking' | 'preload';
	startedAt: number;
}

interface IpcProfileMetadata {
	channel: string;
	usesDatabase: boolean;
}

interface IpcProfileRecord extends IpcProfileMetadata {
	durationMs: number;
	startedAt: number;
}

interface LayoutProfileRecord {
	component: string;
	event: 'mount' | 'unmount';
	startedAt: number;
}

interface PreloadProfileRecord {
	durationMs?: number;
	href: string;
	startedAt: number;
	status: 'failed' | 'resolved' | 'started';
}

interface NavigationProfile {
	fromHref: string;
	hadIntentPreload: boolean;
	hashChanged: boolean;
	hrefChanged: boolean;
	id: number;
	ipcRecords: IpcProfileRecord[];
	layoutRecords: LayoutProfileRecord[];
	loaderRecords: LoaderProfileRecord[];
	pathChanged: boolean;
	startedAt: number;
	toHref: string;
}

const enabled =
	import.meta.env.DEV && typeof window !== 'undefined' && Boolean(console);
const installedRouters = new WeakSet<AnyRouter>();
const lastInputsByRouteId = new Map<string, RouteInputSnapshot>();
const preloadsByHref = new Map<string, PreloadProfileRecord>();

let activeNavigation: NavigationProfile | null = null;
let nextNavigationId = 1;

/**
 * Installs dev-mode TanStack Router subscriptions that record loader/IPC/layout
 * timings for each navigation, logging a console summary on render.
 * @param router - Router instance to instrument; multiple calls are deduped.
 */
export function installRouteNavigationProfiler(router: AnyRouter): void {
	if (!enabled || installedRouters.has(router)) {
		return;
	}

	installedRouters.add(router);
	patchPreloadRoute(router);

	router.subscribe('onBeforeLoad', (event) => {
		activeNavigation = {
			fromHref: getLocationHref(event.fromLocation),
			hadIntentPreload: preloadsByHref.has(event.toLocation.href),
			hashChanged: event.hashChanged,
			hrefChanged: event.hrefChanged,
			id: nextNavigationId,
			ipcRecords: [],
			layoutRecords: [],
			loaderRecords: [],
			pathChanged: event.pathChanged,
			startedAt: now(),
			toHref: event.toLocation.href,
		};
		nextNavigationId += 1;
	});

	router.subscribe('onRendered', (event) => {
		const navigation = activeNavigation;

		if (!navigation || navigation.toHref !== event.toLocation.href) {
			return;
		}

		logNavigationProfile(navigation, router.state.matches);
		activeNavigation = null;
	});
}

/**
 * Wraps a route loader, recording its duration and dependency-change
 * description on the active navigation profile (or as a preload entry).
 * @param metadata - Loader context (route id, params, cause, etc.).
 * @param load - Underlying loader function.
 * @returns The loader's result.
 */
export async function profileRouteLoader<T>(
	metadata: LoaderProfileMetadata,
	load: () => Promise<T> | T,
): Promise<T> {
	if (!enabled) {
		return load();
	}

	const startedAt = now();
	try {
		return await load();
	} finally {
		const record: LoaderProfileRecord = {
			...metadata,
			depsChange: describeRouteInputChange(metadata),
			durationMs: now() - startedAt,
			mode: getLoaderMode(metadata),
			startedAt,
		};

		if (metadata.preload) {
			preloadsByHref.set(metadata.href, {
				durationMs: record.durationMs,
				href: metadata.href,
				startedAt,
				status: 'resolved',
			});
		}

		if (activeNavigation?.toHref === metadata.href) {
			activeNavigation.loaderRecords.push(record);
		}
	}
}

/**
 * Wraps an IPC invoke call, recording its duration on the active navigation
 * profile so the post-navigation log includes per-channel timings.
 * @param metadata - IPC call context.
 * @param call - The actual `ipcRenderer.invoke` call.
 * @returns The IPC response.
 */
export async function profileElectronIpcCall<T>(
	metadata: IpcProfileMetadata,
	call: () => Promise<T>,
): Promise<T> {
	if (!enabled) {
		return call();
	}

	const startedAt = now();

	try {
		return await call();
	} finally {
		activeNavigation?.ipcRecords.push({
			...metadata,
			durationMs: now() - startedAt,
			startedAt,
		});
	}
}

/**
 * React effect hook that records mount/unmount events for layout components
 * onto the active navigation profile.
 * @param component - Label of the component being instrumented.
 */
export function useRouteProfilerMount(component: string): void {
	const useProfilerEffect =
		typeof window === 'undefined' ? useEffect : useLayoutEffect;

	useProfilerEffect(() => {
		recordLayoutEvent(component, 'mount');

		return () => recordLayoutEvent(component, 'unmount');
	}, [component]);
}

/**
 * Monkey-patches `router.preloadRoute` so each intent-based preload is recorded
 * for the eventual navigation profile.
 * @param router - Router to patch.
 */
function patchPreloadRoute(router: AnyRouter): void {
	type PreloadRouteOptions = Parameters<AnyRouter['preloadRoute']>[0];
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

/** Appends a layout mount/unmount record to the active navigation profile. */
function recordLayoutEvent(
	component: string,
	event: LayoutProfileRecord['event'],
) {
	if (!enabled) {
		return;
	}

	activeNavigation?.layoutRecords.push({
		component,
		event,
		startedAt: now(),
	});
}

/**
 * Compares this loader run's params/deps against the previous run for the same
 * route id and returns a human-readable summary of what changed.
 * @param metadata - Loader profile metadata.
 * @returns A short description of the change since the last invocation.
 */
function describeRouteInputChange(metadata: LoaderProfileMetadata): string {
	const previous = lastInputsByRouteId.get(metadata.routeId);
	const current = {
		deps: metadata.deps,
		params: metadata.params,
	};

	lastInputsByRouteId.set(metadata.routeId, current);

	if (!previous) {
		return 'first run';
	}

	const depChanges = getChangedKeys(previous.deps, metadata.deps);

	if (depChanges.length) {
		return `loaderDeps changed: ${depChanges.join(', ')}`;
	}

	const paramChanges = getChangedKeys(previous.params, metadata.params);

	if (paramChanges.length) {
		return `loaderDeps unchanged; params changed: ${paramChanges.join(', ')}`;
	}

	return 'loaderDeps unchanged';
}

/**
 * Returns the keys whose JSON-stringified values differ between two records.
 * @param previous - Previous value.
 * @param next - Next value.
 * @returns Changed keys, or `['value']` for non-object diffs.
 */
function getChangedKeys(previous: unknown, next: unknown): string[] {
	const previousRecord = toRecord(previous);
	const nextRecord = toRecord(next);

	if (!previousRecord || !nextRecord) {
		return stableJson(previous) === stableJson(next) ? [] : ['value'];
	}

	const keys = new Set([
		...Object.keys(previousRecord),
		...Object.keys(nextRecord),
	]);

	return Array.from(keys).filter(
		(key) => stableJson(previousRecord[key]) !== stableJson(nextRecord[key]),
	);
}

/** Coerces an unknown value to a record, or `null` for non-object inputs. */
function toRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null
		? (value as Record<string, unknown>)
		: null;
}

/** Picks the loader mode label (preload, background, or blocking). */
function getLoaderMode(
	metadata: LoaderProfileMetadata,
): LoaderProfileRecord['mode'] {
	if (metadata.preload) {
		return 'preload';
	}

	if (metadata.staleReloadMode === 'background' && metadata.cause === 'stay') {
		return 'background';
	}

	return 'blocking';
}

/**
 * Emits the dev-console summary for one completed navigation, including loader
 * rows, IPC rows, layout-remount counts and preload state.
 * @param navigation - Completed navigation profile.
 * @param matches - Active route matches at render time.
 */
function logNavigationProfile(
	navigation: NavigationProfile,
	matches: AnyRouteMatch[],
) {
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

/** Renders a parsed location's href, falling back to `(initial)` when absent. */
function getLocationHref(location: ParsedLocation | undefined): string {
	return location?.href ?? '(initial)';
}

/** Returns a monotonic millisecond timestamp from `performance.now`. */
function now(): number {
	return performance.now();
}

/** Rounds a duration in ms to a single decimal place for readable logs. */
function roundMs(value: number): number {
	return Math.round(value * 10) / 10;
}

/**
 * Stringifies a value in a stable, dev-only-friendly way for diffing.
 * @param value - Value to stringify.
 * @returns A JSON-ish string representation.
 */
function stableJson(value: unknown): string {
	if (value === undefined) {
		return 'undefined';
	}

	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}
