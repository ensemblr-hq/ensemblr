import type { SetupDiagnosticsStatus } from '@/shared/ipc/contracts/setup';

/**
 * Pure poll driver for the setup-diagnostics query.
 *
 * A single boot-time probe can report a blocked/checking status while a
 * dependency is still warming up (most notably the Pi RPC smoke check timing
 * out on a cold `pi` start). Nothing else refetches, so that transient failure
 * would stick until the user opened the Diagnostics screen. This driver polls
 * until the snapshot reports `ready`, then stops — and bounds the pathological
 * case (a genuinely blocked setup) so it cannot re-run every server-side check
 * every few seconds for the whole session.
 *
 * TanStack re-evaluates a functional `refetchInterval` on observer updates, not
 * only after a fetch settles, so the ceiling is counted against the query's
 * completed-fetch count rather than raw evaluations. An evaluation that sees no
 * new fetch since the last counted poll leaves the budget untouched.
 */

/** Poll cadence, in ms, while setup diagnostics are still settling after boot. */
export const SETUP_DIAGNOSTICS_POLL_MS = 4000;
/**
 * Hard cap on consecutive not-ready polls before the driver gives up. At
 * {@link SETUP_DIAGNOSTICS_POLL_MS} this is a ~60s window — long enough to heal
 * a cold-start failure, short enough that a permanently blocked setup stops
 * hammering the main process. Reset once the snapshot reaches `ready`, so a
 * later `ready → blocked` regression re-arms the poll on the next fetch.
 */
const MAX_POLLS = 15;

/** Immutable progress of the setup-diagnostics settling poll. */
export interface SetupDiagnosticsPollState {
	/** Not-ready fetches counted so far against {@link MAX_POLLS}. */
	totalPolls: number;
	/** Query completed-fetch count at the last counted poll, so re-evaluations
	 * that carry no new fetch do not burn the budget. */
	lastFetchCount: number;
}

/** The zero state for a fresh {@link advanceSetupDiagnosticsPoll} run. */
export function initialSetupDiagnosticsPollState(): SetupDiagnosticsPollState {
	return { lastFetchCount: 0, totalPolls: 0 };
}

/**
 * Decides the next `refetchInterval` for the setup-diagnostics query and
 * returns the advanced poll state. Stops (and resets) once the snapshot is
 * `ready`, keeps polling every {@link SETUP_DIAGNOSTICS_POLL_MS} while it is
 * not, and stops at the {@link MAX_POLLS} ceiling so a persistently blocked
 * setup cannot poll forever. The budget only advances when `fetchCount` has
 * moved since the last counted poll, so repeated evaluations between fetches
 * neither shorten the window nor re-fire a check.
 * @param status - The status of the snapshot the query currently exposes, if any.
 * @param fetchCount - The query's monotonic completed-fetch count.
 * @param state - The prior poll state.
 * @returns The next interval (or `false` to stop) plus the advanced state.
 */
export function advanceSetupDiagnosticsPoll(
	status: SetupDiagnosticsStatus | undefined,
	fetchCount: number,
	state: SetupDiagnosticsPollState,
): { intervalMs: number | false; state: SetupDiagnosticsPollState } {
	if (status === 'ready') {
		return { intervalMs: false, state: initialSetupDiagnosticsPollState() };
	}

	const capped = state.totalPolls >= MAX_POLLS;
	if (fetchCount === state.lastFetchCount) {
		return { intervalMs: capped ? false : SETUP_DIAGNOSTICS_POLL_MS, state };
	}

	const totalPolls = state.totalPolls + 1;
	const advanced: SetupDiagnosticsPollState = {
		lastFetchCount: fetchCount,
		totalPolls,
	};
	if (totalPolls >= MAX_POLLS) {
		return { intervalMs: false, state: advanced };
	}
	return { intervalMs: SETUP_DIAGNOSTICS_POLL_MS, state: advanced };
}
