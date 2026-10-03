/** The part of a queued job the grant order depends on. */
export interface QueuedEntry {
	id: string;
	/** Monotonic enqueue sequence; breaks ties deterministically. */
	sequence: number;
	workspaceId: string;
}

/**
 * Orders queued jobs the way the queue will grant them: round-robin across
 * workspaces, always serving the workspace whose most recent grant is oldest
 * (a never-granted workspace first, ties going to whichever has the earliest
 * queued job), and first-in-first-out within a workspace. One workspace's
 * burst therefore waits behind every other workspace's next job.
 * @param queued - Queued jobs in enqueue order.
 * @param lastGrantTicks - Grant tick of each workspace's most recent grant.
 * @returns Job ids in grant order; index + 1 is a job's queue position.
 */
export function computeGrantOrder(
	queued: readonly QueuedEntry[],
	lastGrantTicks: ReadonlyMap<string, number>,
): string[] {
	const lanes = new Map<string, QueuedEntry[]>();
	for (const entry of [...queued].sort((a, b) => a.sequence - b.sequence)) {
		lanes.set(entry.workspaceId, [
			...(lanes.get(entry.workspaceId) ?? []),
			entry,
		]);
	}

	const ticks = new Map(lastGrantTicks);
	const cursors = new Map<string, number>();
	const order: string[] = [];
	let simulatedTick = Math.max(0, ...ticks.values());

	while (order.length < queued.length) {
		const next = pickNextLane(lanes, cursors, ticks);
		if (next === null) {
			break;
		}
		const cursor = cursors.get(next) ?? 0;
		const entry = lanes.get(next)?.[cursor];
		if (entry === undefined) {
			break;
		}
		order.push(entry.id);
		cursors.set(next, cursor + 1);
		simulatedTick += 1;
		ticks.set(next, simulatedTick);
	}

	return order;
}

/**
 * Picks the workspace lane to serve next among lanes with jobs left.
 * @param lanes - Each workspace's queued jobs in FIFO order.
 * @param cursors - How many jobs of each lane are already ordered.
 * @param ticks - Each workspace's most recent (real or simulated) grant tick.
 * @returns The chosen workspace id, or null when every lane is exhausted.
 */
function pickNextLane(
	lanes: ReadonlyMap<string, readonly QueuedEntry[]>,
	cursors: ReadonlyMap<string, number>,
	ticks: ReadonlyMap<string, number>,
): string | null {
	let best: { head: number; tick: number; workspaceId: string } | null = null;

	for (const [workspaceId, entries] of lanes) {
		const head = entries[cursors.get(workspaceId) ?? 0];
		if (head === undefined) {
			continue;
		}
		const tick = ticks.get(workspaceId) ?? Number.NEGATIVE_INFINITY;
		const better =
			best === null ||
			tick < best.tick ||
			(tick === best.tick && head.sequence < best.head);
		if (better) {
			best = { head: head.sequence, tick, workspaceId };
		}
	}

	return best?.workspaceId ?? null;
}
