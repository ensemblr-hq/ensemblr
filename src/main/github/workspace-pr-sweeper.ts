/** One non-archived workspace the sweeper should refresh. */
export interface SweepableWorkspace {
	id: string;
	path: string;
}

/** Dependencies for {@link createWorkspacePrStatusSweeper}. */
export interface WorkspacePrStatusSweeperOptions {
	/** Lists the non-archived workspaces to refresh on each sweep. */
	listActiveWorkspaces: () => readonly SweepableWorkspace[];
	/**
	 * Refreshes and persists one workspace's cached PR snapshot. Must resolve
	 * even on failure (gh error, no remote) so one bad workspace never aborts the
	 * sweep — the underlying service already swallows gh failures.
	 */
	refreshSnapshot: (input: {
		workspaceCwd: string;
		workspaceId: string;
	}) => Promise<void>;
	/** Interval scheduler seam; defaults to `setInterval`. */
	scheduleInterval?: (callback: () => void, ms: number) => () => void;
	/** How often to sweep, in ms. Defaults to {@link DEFAULT_SWEEP_INTERVAL_MS}. */
	intervalMs?: number;
}

/** Public surface of the workspace PR-status sweeper. */
export interface WorkspacePrStatusSweeper {
	/** Runs an immediate sweep and starts the recurring one. */
	start: () => void;
	/** Stops the recurring sweep. */
	dispose: () => void;
}

/**
 * Default sweep cadence. Long enough to keep `gh` traffic modest across many
 * workspaces (the sweep fetches sequentially), short enough that a merged PR or
 * failing check surfaces on cold sidebar rows within a couple of minutes.
 */
const DEFAULT_SWEEP_INTERVAL_MS = 120_000;

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
 * Periodically refreshes every non-archived workspace's cached GitHub PR
 * snapshot so sidebar rows reflect real merge/checks status even for workspaces
 * the user has not opened this session. Fetches sequentially to keep `gh` load
 * bounded, and never throws out of a sweep so one failing workspace cannot stall
 * the rest.
 *
 * @param options - Workspace listing, snapshot refresh, and scheduling seams.
 * @returns The sweeper handle.
 */
export function createWorkspacePrStatusSweeper(
	options: WorkspacePrStatusSweeperOptions,
): WorkspacePrStatusSweeper {
	const scheduleInterval = options.scheduleInterval ?? defaultSchedule;
	const intervalMs = options.intervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
	let cancel: (() => void) | null = null;
	let running = false;

	const sweep = async (): Promise<void> => {
		if (running) {
			return;
		}
		running = true;
		try {
			// Chain refreshes so each gh-heavy snapshot finishes before the next starts.
			await options
				.listActiveWorkspaces()
				.reduce<Promise<void>>(async (previousRefresh, workspace) => {
					// react-doctor-disable-next-line -- Sequential gh calls intentionally bound subprocess and API load.
					await previousRefresh;
					try {
						await options.refreshSnapshot({
							workspaceCwd: workspace.path,
							workspaceId: workspace.id,
						});
					} catch {
						// A single workspace's refresh failing must not stop the sweep.
					}
				}, Promise.resolve());
		} finally {
			running = false;
		}
	};

	const start = (): void => {
		if (cancel) {
			return;
		}
		void sweep();
		cancel = scheduleInterval(() => void sweep(), intervalMs);
	};

	const dispose = (): void => {
		cancel?.();
		cancel = null;
	};

	return { dispose, start };
}
