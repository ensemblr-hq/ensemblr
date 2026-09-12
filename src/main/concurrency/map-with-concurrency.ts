/**
 * Maps items through an async worker, keeping at most `limit` in flight.
 *
 * The main process fans out to `git`, to the filesystem, and to `gh` from
 * several places at once, and an unbounded `Promise.all` over a user-sized list
 * is what turns those into a stall: every spawn costs main-thread setup, pipe
 * wiring and a promise settle, and every open file descriptor is one the next
 * caller does not have. Bounding the fan-out keeps the same total work off the
 * same one-second window.
 *
 * Results come back in input order, and the first rejection rejects the whole
 * call — workers already running settle, but no new one starts.
 * @param items - Inputs to map.
 * @param limit - Maximum workers in flight; values below 1 are treated as 1.
 * @param worker - Async mapper, given an item and its index.
 * @returns The mapped results, in the order the items were given.
 */
export async function mapWithConcurrency<Item, Result>(
	items: readonly Item[],
	limit: number,
	worker: (item: Item, index: number) => Promise<Result>,
): Promise<Result[]> {
	const results = new Array<Result>(items.length);
	const width = Math.min(Math.max(1, Math.floor(limit)), items.length);
	let next = 0;

	const runSlot = async (): Promise<void> => {
		while (next < items.length) {
			const index = next;
			next += 1;
			results[index] = await worker(items[index] as Item, index);
		}
	};

	await Promise.all(Array.from({ length: width }, runSlot));

	return results;
}
