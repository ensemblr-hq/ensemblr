/**
 * Data-record types for the dev-mode route navigation profiler in
 * `lib/instrumentation`. The profiler collects per-navigation loader, IPC, and
 * layout timings; these interfaces describe the records it accumulates and logs.
 */

/** Why a route loader ran: fresh navigation, intent preload, or staying on the route. */
type LoaderCause = 'enter' | 'preload' | 'stay';
/** How a stale-data loader reload runs: in the background or blocking navigation. */
type LoaderStaleReloadMode = 'background' | 'blocking';

/** Metadata describing a single route loader invocation. */
export interface LoaderProfileMetadata {
	cause: LoaderCause;
	deps: unknown;
	href: string;
	params?: Record<string, unknown>;
	preload: boolean;
	routeId: string;
	staleReloadMode: LoaderStaleReloadMode;
}

/** A completed loader invocation with its timing and change detection. */
export interface LoaderProfileRecord extends LoaderProfileMetadata {
	depsChange: string;
	durationMs: number;
	mode: 'background' | 'blocking' | 'preload';
	startedAt: number;
}

/** Metadata describing a single IPC call captured during navigation. */
export interface IpcProfileMetadata {
	channel: string;
	usesDatabase: boolean;
}

/** A completed IPC call with its timing. */
interface IpcProfileRecord extends IpcProfileMetadata {
	durationMs: number;
	startedAt: number;
}

/** A layout component mount or unmount event captured during navigation. */
export interface LayoutProfileRecord {
	component: string;
	event: 'mount' | 'unmount';
	startedAt: number;
}

/** Aggregated profile of one navigation, collecting its loader, IPC, layout, and preload records. */
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
