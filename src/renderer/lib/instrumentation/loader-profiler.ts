import type { AnyRouter } from '@tanstack/react-router';
import { logNavigationProfile, patchPreloadRoute } from './navigation-reporter';
import {
	consumeNextNavigationId,
	enabled,
	getActiveNavigation,
	getLocationHref,
	installedRouters,
	type LoaderProfileMetadata,
	type LoaderProfileRecord,
	lastInputsByRouteId,
	now,
	preloadsByHref,
	setActiveNavigation,
	stableJson,
} from './profiler-store';

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
		setActiveNavigation({
			fromHref: getLocationHref(event.fromLocation),
			hadIntentPreload: preloadsByHref.has(event.toLocation.href),
			hashChanged: event.hashChanged,
			hrefChanged: event.hrefChanged,
			id: consumeNextNavigationId(),
			ipcRecords: [],
			layoutRecords: [],
			loaderRecords: [],
			pathChanged: event.pathChanged,
			startedAt: now(),
			toHref: event.toLocation.href,
		});
	});

	router.subscribe('onRendered', (event) => {
		const navigation = getActiveNavigation();

		if (!navigation || navigation.toHref !== event.toLocation.href) {
			return;
		}

		logNavigationProfile(navigation, router.state.matches);
		setActiveNavigation(null);
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

		const active = getActiveNavigation();
		if (active?.toHref === metadata.href) {
			active.loaderRecords.push(record);
		}
	}
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
