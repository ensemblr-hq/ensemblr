import type { AnyRouter, ParsedLocation } from '@tanstack/react-router';

export type LoaderCause = 'enter' | 'preload' | 'stay';
export type LoaderStaleReloadMode = 'background' | 'blocking';

export interface RouteInputSnapshot {
	deps: unknown;
	params?: Record<string, unknown>;
}

export interface LoaderProfileMetadata {
	cause: LoaderCause;
	deps: unknown;
	href: string;
	params?: Record<string, unknown>;
	preload: boolean;
	routeId: string;
	staleReloadMode: LoaderStaleReloadMode;
}

export interface LoaderProfileRecord extends LoaderProfileMetadata {
	depsChange: string;
	durationMs: number;
	mode: 'background' | 'blocking' | 'preload';
	startedAt: number;
}

export interface IpcProfileMetadata {
	channel: string;
	usesDatabase: boolean;
}

export interface IpcProfileRecord extends IpcProfileMetadata {
	durationMs: number;
	startedAt: number;
}

export interface LayoutProfileRecord {
	component: string;
	event: 'mount' | 'unmount';
	startedAt: number;
}

export interface PreloadProfileRecord {
	durationMs?: number;
	href: string;
	startedAt: number;
	status: 'failed' | 'resolved' | 'started';
}

export interface NavigationProfile {
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

/**
 * Whether profiling is active. Profiling is gated to dev-mode browser sessions
 * with a working `console` so production builds incur zero cost.
 */
export const enabled =
	import.meta.env.DEV && typeof window !== 'undefined' && Boolean(console);

/** Set of routers that already have the profiler installed (dedupe guard). */
export const installedRouters = new WeakSet<AnyRouter>();

/** Last-seen loader input snapshot keyed by route id, used for diffing. */
export const lastInputsByRouteId = new Map<string, RouteInputSnapshot>();

/** Active and resolved preload records keyed by target href. */
export const preloadsByHref = new Map<string, PreloadProfileRecord>();

let activeNavigation: NavigationProfile | null = null;
let nextNavigationId = 1;

/** Returns the in-flight navigation profile, or `null` when none is active. */
export function getActiveNavigation(): NavigationProfile | null {
	return activeNavigation;
}

/** Replaces the in-flight navigation profile. */
export function setActiveNavigation(
	navigation: NavigationProfile | null,
): void {
	activeNavigation = navigation;
}

/** Returns the next navigation id and advances the counter. */
export function consumeNextNavigationId(): number {
	const id = nextNavigationId;
	nextNavigationId += 1;
	return id;
}

/** Renders a parsed location's href, falling back to `(initial)` when absent. */
export function getLocationHref(location: ParsedLocation | undefined): string {
	return location?.href ?? '(initial)';
}

/** Returns a monotonic millisecond timestamp from `performance.now`. */
export function now(): number {
	return performance.now();
}

/** Rounds a duration in ms to a single decimal place for readable logs. */
export function roundMs(value: number): number {
	return Math.round(value * 10) / 10;
}

/**
 * Stringifies a value in a stable, dev-only-friendly way for diffing.
 * @param value - Value to stringify.
 * @returns A JSON-ish string representation.
 */
export function stableJson(value: unknown): string {
	if (value === undefined) {
		return 'undefined';
	}

	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}
