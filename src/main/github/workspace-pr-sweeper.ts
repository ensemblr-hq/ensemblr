/** One non-archived workspace the sweeper should refresh. */
export interface SweepableWorkspace {
	/**
	 * Whether the workspace's cached snapshot holds an open pull request with a
	 * check still running. Those rows are the ones whose persisted status goes
	 * wrong fastest — a check finishing is invisible until the next refresh — so
	 * they are swept on the short cadence.
	 */
	hasPendingChecks: boolean;
	id: string;
	path: string;
}

/** Dependencies for {@link createWorkspacePrStatusSweeper}. */
export interface WorkspacePrStatusSweeperOptions {
	/**
	 * How often a workspace with no checks in flight is refreshed. Defaults to
	 * {@link DEFAULT_IDLE_SWEEP_INTERVAL_MS}.
	 */
	idleIntervalMs?: number;
	/** Lists the non-archived workspaces to refresh on each sweep. */
	listActiveWorkspaces: () => readonly SweepableWorkspace[];
	/** Clock seam; defaults to `Date.now`. */
	now?: () => number;
	/**
	 * How often a workspace with checks in flight is refreshed, which is also the
	 * tick cadence. Defaults to {@link DEFAULT_PENDING_SWEEP_INTERVAL_MS}.
	 */
	pendingIntervalMs?: number;
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
}

/** Public surface of the workspace PR-status sweeper. */
export interface WorkspacePrStatusSweeper {
	/** Runs an immediate sweep and starts the recurring one. */
	start: () => void;
	/** Stops the recurring sweep. */
	dispose: () => void;
}

/**
 * Cadence for a workspace whose pull request has a check in flight. A check
 * completing is the transition that makes the persisted status wrong, and the
 * whole app reads that persisted status until a live snapshot lands — so the
 * window between "checks passed" and "the app knows" is what a user sees as the
 * sidebar row, header pill, and Checks panel briefly disagreeing with GitHub.
 * Kept at half a minute rather than lower because each snapshot costs several
 * `gh` calls and only a handful of workspaces ever have checks running at once.
 */
const DEFAULT_PENDING_SWEEP_INTERVAL_MS = 30_000;

/**
 * Cadence for every other workspace. Long enough to keep `gh` traffic modest
 * across many workspaces (the sweep fetches sequentially), short enough that a
 * merged pull request or a newly failing check surfaces on cold sidebar rows
 * within a couple of minutes.
 */
const DEFAULT_IDLE_SWEEP_INTERVAL_MS = 120_000;

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
 * the user has not opened this session. Workspaces with a check in flight are
 * swept on a short cadence and the rest on a long one, so the status a freshly
 * opened workspace renders before its own live fetch lands is rarely stale.
 * Fetches sequentially to keep `gh` load bounded, and never throws out of a
 * sweep so one failing workspace cannot stall the rest.
 *
 * @param options - Workspace listing, snapshot refresh, clock, and scheduling seams.
 * @returns The sweeper handle.
 */
export function createWorkspacePrStatusSweeper(
	options: WorkspacePrStatusSweeperOptions,
): WorkspacePrStatusSweeper {
	const scheduleInterval = options.scheduleInterval ?? defaultSchedule;
	const now = options.now ?? Date.now;
	const pendingIntervalMs =
		options.pendingIntervalMs ?? DEFAULT_PENDING_SWEEP_INTERVAL_MS;
	const idleIntervalMs =
		options.idleIntervalMs ?? DEFAULT_IDLE_SWEEP_INTERVAL_MS;
	let cancel: (() => void) | null = null;
	let running = false;
	let sweptAtByWorkspaceId: ReadonlyMap<string, number> = new Map();

	/**
	 * Whether a workspace is due for a refresh, on the cadence its check state
	 * earns it. A workspace seen for the first time is always due.
	 * @param workspace - The workspace to test.
	 * @param currentMs - The timestamp this sweep started at.
	 * @returns True when the workspace should be refreshed in this sweep.
	 */
	const isDue = (workspace: SweepableWorkspace, currentMs: number): boolean => {
		const sweptAtMs = sweptAtByWorkspaceId.get(workspace.id);
		if (sweptAtMs === undefined) {
			return true;
		}
		const intervalMs = workspace.hasPendingChecks
			? pendingIntervalMs
			: idleIntervalMs;
		return currentMs - sweptAtMs >= intervalMs;
	};

	/**
	 * Records the sweep for the workspaces it covered and forgets ids that are no
	 * longer listed, so an archived workspace cannot pin an entry forever.
	 * @param listed - Every workspace this sweep considered.
	 * @param swept - The workspaces this sweep refreshed.
	 * @param sweptAtMs - The timestamp this sweep started at.
	 */
	const recordSweep = (
		listed: readonly SweepableWorkspace[],
		swept: readonly SweepableWorkspace[],
		sweptAtMs: number,
	): void => {
		const sweptIds = new Set(swept.map((workspace) => workspace.id));
		const carried = listed.flatMap((workspace): [string, number][] => {
			const previousMs = sweptAtByWorkspaceId.get(workspace.id);
			return sweptIds.has(workspace.id) || previousMs === undefined
				? []
				: [[workspace.id, previousMs]];
		});
		sweptAtByWorkspaceId = new Map([
			...carried,
			...swept.map((workspace): [string, number] => [workspace.id, sweptAtMs]),
		]);
	};

	/**
	 * The workspaces to consider this sweep, or none when the listing itself
	 * fails. Both call sites fire the sweep as `void sweep()`, so a database read
	 * throwing here — the connection closing mid-sweep on quit, say — would
	 * surface as an unhandled rejection rather than a skipped tick.
	 * @returns The listed workspaces, empty when the listing failed.
	 */
	const listWorkspaces = (): readonly SweepableWorkspace[] => {
		try {
			return options.listActiveWorkspaces();
		} catch {
			return [];
		}
	};

	const sweep = async (): Promise<void> => {
		if (running) {
			return;
		}
		running = true;
		try {
			const listed = listWorkspaces();
			const sweptAtMs = now();
			const due = listed.filter((workspace) => isDue(workspace, sweptAtMs));
			// Chain refreshes so each gh-heavy snapshot finishes before the next starts.
			await due.reduce<Promise<void>>(async (previousRefresh, workspace) => {
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
			recordSweep(listed, due, sweptAtMs);
		} finally {
			running = false;
		}
	};

	const start = (): void => {
		if (cancel) {
			return;
		}
		void sweep();
		cancel = scheduleInterval(() => void sweep(), pendingIntervalMs);
	};

	const dispose = (): void => {
		cancel?.();
		cancel = null;
	};

	return { dispose, start };
}
