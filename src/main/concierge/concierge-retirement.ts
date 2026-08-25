/**
 * Bookkeeping for the runtime children a Concierge clear replaced but left
 * running long enough to write their memories. Tracked rather than fired and
 * forgotten, so a quit closes them instead of leaving a runtime process and its
 * control token behind — and so the two paths that can close one, the pass
 * landing and the shutdown draining, never close the same child twice.
 */

/** What the tracker needs of a child: something it can be told to close. */
export interface ConciergeRetirement<TChild> {
	/**
	 * Tracks a retired child and closes it once `until` settles, unless a drain
	 * closed it first. Never awaited by the caller: the clear that retired the
	 * child has already handed the user a fresh conversation.
	 * @param child - The child to keep open.
	 * @param until - Resolves when the child has no more work to do.
	 */
	keepAlive: (child: TChild, until: Promise<unknown>) => void;
	/**
	 * Closes every child still being kept alive, abandoning rather than awaiting
	 * whatever they were running. Called at quit, where an unbounded wait costs
	 * more than one conversation's notes.
	 */
	drain: () => Promise<void>;
}

/**
 * How many retired children may write their memories at once.
 *
 * Each one is a whole runtime process running an unattended turn, so the set is
 * a fan-out the user never asked for and cannot see. Three covers clearing a few
 * conversations in a row; past that the oldest is closed mid-pass, which costs
 * that conversation's notes — the price the pass is already documented as being
 * worth, and far below a machine carrying one agent per keystroke.
 */
const MAX_CONCURRENT_RETIREMENTS = 3;

/**
 * Builds a {@link ConciergeRetirement} over the caller's close routine.
 * @param close - Closes one child and drops everything it held open.
 * @returns The tracker.
 */
export function createConciergeRetirement<TChild>(
	close: (child: TChild) => Promise<void>,
): ConciergeRetirement<TChild> {
	const retiring = new Set<TChild>();

	/**
	 * Closes the children over the cap, oldest first — a `Set` iterates in
	 * insertion order, so the one that has had the longest to finish goes first.
	 */
	const shedOverflow = (): void => {
		for (const child of retiring) {
			if (retiring.size <= MAX_CONCURRENT_RETIREMENTS) {
				return;
			}
			retiring.delete(child);
			void close(child);
		}
	};

	return {
		drain: async (): Promise<void> => {
			const abandoned = [...retiring];
			retiring.clear();
			await Promise.all(abandoned.map(close));
		},

		keepAlive: (child: TChild, until: Promise<unknown>): void => {
			retiring.add(child);
			void until.then(async () => {
				// `delete` reporting false means a drain already closed it, so this is
				// how the two paths avoid closing the same child twice.
				if (retiring.delete(child)) {
					await close(child);
				}
			});
			shedOverflow();
		},
	};
}
