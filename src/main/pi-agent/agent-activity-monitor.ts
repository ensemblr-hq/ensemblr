import type { AppSettings } from '../../shared/config/app-settings.ts';
import type { PiSessionEventWire } from '../../shared/ipc/contracts/pi-session.ts';

/** One persisted Pi event plus the session it belongs to. */
interface AgentActivityEvent {
	event: PiSessionEventWire;
	sessionId: string;
}

/** Thin seam over Electron's `powerSaveBlocker` so the monitor stays testable. */
export interface PowerSaveControls {
	start: (type: 'prevent-app-suspension' | 'prevent-display-sleep') => number;
	stop: (id: number) => void;
}

/** Current battery reading; `charging` includes "on AC power". */
export interface BatterySnapshot {
	charging: boolean;
	percent: number;
}

/** Options for {@link createAgentActivityMonitor}. */
export interface AgentActivityMonitorOptions {
	/** Reads the live App settings (config.json is the source of truth). */
	readSettings: () => AppSettings;
	/** Power-blocker seam; defaults to Electron's `powerSaveBlocker`. */
	powerControls?: PowerSaveControls;
	/** Emits a desktop notification; defaults to Electron `Notification`. */
	notify?: (options: { title: string; body: string }) => void;
	/** True when any app window is focused; suppresses notifications. */
	isAppFocused?: () => boolean;
	/**
	 * Reads the current battery, or `null` when unknown / no battery. Async so the
	 * real (`pmset`) implementation never blocks the main thread; the monitor
	 * caches the result and reconciles when it resolves.
	 */
	readBattery?: () => Promise<BatterySnapshot | null>;
	/** Schedules the recurring battery re-check; returns a canceller. */
	scheduleInterval?: (callback: () => void, ms: number) => () => void;
	/** Monotonic clock for the sample-freshness TTL; defaults to `Date.now`. */
	now?: () => number;
}

/** Public surface of the agent activity monitor. */
interface AgentActivityMonitor {
	/** Feed every persisted Pi session event here. */
	handle: (input: AgentActivityEvent) => void;
	/** Re-evaluate the power blocker (e.g. after a settings change). */
	refresh: () => void;
	/** Release the blocker and timers (call on app quit). */
	dispose: () => void;
}

/** Below this charge (and not charging) the caffeinate blocker shuts off. */
const BATTERY_CUTOFF_PERCENT = 10;
/** How often to re-check the battery while the blocker is engaged. */
const BATTERY_POLL_MS = 60_000;
/** A cached battery reading older than this is refreshed before it's trusted. */
const BATTERY_SAMPLE_TTL_MS = 30_000;

// Inert defaults keep this module free of the `electron` import so it unit-tests
// under a plain Node/bun runtime. The real Electron-backed controls, notifier,
// and focus check are injected from `electron-activity-bindings.ts` in main.ts.
const inertPowerControls: PowerSaveControls = {
	/** Inert power-blocker start; returns a placeholder id. */
	start: () => 0,
	/** Inert power-blocker stop; does nothing. */
	stop: () => undefined,
};

/**
 * Default interval scheduler backed by `setInterval`.
 * @param callback - Function to run on each tick.
 * @param ms - Interval delay in milliseconds.
 * @returns A canceller that clears the interval.
 */
function defaultSchedule(callback: () => void, ms: number): () => void {
	const timer = setInterval(callback, ms);
	return () => clearInterval(timer);
}

/**
 * Drives the two main-process side-effects behind the General settings:
 * `caffeinateWhileRunning` (hold a power-save blocker while any session is
 * streaming) and `desktopNotifications` (notify when a turn finishes while the
 * app is in the background).
 *
 * Streaming state is derived from persisted `status` / `shutdown` events, so the
 * monitor never has to poll session rows. Settings are read live on each
 * relevant event, so toggling a switch takes effect without a restart.
 */
export function createAgentActivityMonitor(
	options: AgentActivityMonitorOptions,
): AgentActivityMonitor {
	const power = options.powerControls ?? inertPowerControls;
	const notify = options.notify ?? (() => undefined);
	const isAppFocused = options.isAppFocused ?? (() => false);
	const readBattery = options.readBattery ?? (() => Promise.resolve(null));
	const scheduleInterval = options.scheduleInterval ?? defaultSchedule;
	const now = options.now ?? Date.now;

	const streamingSessions = new Set<string>();
	let blockerId: number | null = null;
	let cancelPoll: (() => void) | null = null;

	// Cached battery reading. The async `readBattery` never runs on the hot path;
	// `reconcilePower` consults this snapshot and refreshes it in the background.
	let lastBattery: BatterySnapshot | null = null;
	let batterySampledAt = Number.NEGATIVE_INFINITY;
	let sampling = false;

	const batteryAllowsBlock = (): boolean => {
		if (!lastBattery || lastBattery.charging) {
			return true;
		}
		return lastBattery.percent >= BATTERY_CUTOFF_PERCENT;
	};

	// Refresh the cached reading off the main thread, then re-reconcile so a
	// drained laptop releases the blocker (and a freshly-plugged one re-engages).
	const sampleBattery = (): void => {
		if (sampling) {
			return;
		}
		sampling = true;
		void readBattery()
			.then((battery) => {
				lastBattery = battery;
			})
			.catch(() => {
				lastBattery = null;
			})
			.finally(() => {
				batterySampledAt = now();
				sampling = false;
				reconcilePower();
			});
	};

	const reconcilePower = (): void => {
		const settings = options.readSettings();
		const wantBlock =
			settings.general.caffeinateWhileRunning && streamingSessions.size > 0;
		if (wantBlock && now() - batterySampledAt >= BATTERY_SAMPLE_TTL_MS) {
			const firstSample = batterySampledAt === Number.NEGATIVE_INFINITY;
			sampleBattery();
			// On the very first read, defer the decision until it lands so we never
			// engage on battery only to release it a tick later.
			if (firstSample) {
				return;
			}
		}
		const shouldBlock = wantBlock && batteryAllowsBlock();
		if (shouldBlock && blockerId === null) {
			blockerId = power.start('prevent-app-suspension');
			// Force-refresh the battery while engaged (bypassing the TTL gate) so a
			// draining laptop releases the blocker; `sampleBattery` re-reconciles.
			cancelPoll = scheduleInterval(sampleBattery, BATTERY_POLL_MS);
		} else if (!shouldBlock && blockerId !== null) {
			power.stop(blockerId);
			blockerId = null;
			cancelPoll?.();
			cancelPoll = null;
		}
	};

	const notifyTurnFinished = (): void => {
		const settings = options.readSettings();
		if (!settings.general.desktopNotifications || isAppFocused()) {
			return;
		}
		notify({ title: 'Ensemblr', body: 'Pi finished working in a chat.' });
	};

	const handle = ({ event, sessionId }: AgentActivityEvent): void => {
		const payload = event.payload;
		if (!payload) {
			return;
		}
		if (payload.kind === 'status') {
			const active =
				payload.status === 'streaming' || payload.status === 'starting';
			if (active) {
				streamingSessions.add(sessionId);
			} else {
				const wasActive = streamingSessions.delete(sessionId);
				if (wasActive && payload.status === 'idle') {
					notifyTurnFinished();
				}
			}
			reconcilePower();
			return;
		}
		if (payload.kind === 'shutdown') {
			streamingSessions.delete(sessionId);
			reconcilePower();
		}
	};

	const dispose = (): void => {
		cancelPoll?.();
		cancelPoll = null;
		if (blockerId !== null) {
			power.stop(blockerId);
			blockerId = null;
		}
		streamingSessions.clear();
	};

	return { handle, refresh: reconcilePower, dispose };
}
