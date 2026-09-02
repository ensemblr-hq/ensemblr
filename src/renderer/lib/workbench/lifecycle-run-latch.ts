/**
 * Operation keys of the workspace lifecycle runs currently in flight.
 *
 * Module-scoped rather than a ref because no single component owns the action:
 * the archive dialog form remounts on every open, and the Workspace menu, the
 * sidebar row and the board card each hold their own handler for the same
 * workspace. A per-hook guard would let any two of them start the same
 * destructive IPC twice.
 *
 * The latch covers the IPC and nothing after it — the key is released the moment
 * the call answers, so post-removal work that stalls never strands the target
 * behind a latch it can no longer clear.
 */
const runsInFlight = new Set<string>();

/**
 * Claims the latch for one lifecycle run.
 * @param operationKey - Identifies the run, such as `archive-workspace:<id>`
 * @returns False when a run under this key is already in flight
 */
export function claimLifecycleRun(operationKey: string): boolean {
	if (runsInFlight.has(operationKey)) {
		return false;
	}
	runsInFlight.add(operationKey);
	return true;
}

/**
 * Releases the latch a lifecycle run claimed, whatever its outcome.
 * @param operationKey - The key passed to {@link claimLifecycleRun}
 */
export function releaseLifecycleRun(operationKey: string): void {
	runsInFlight.delete(operationKey);
}
