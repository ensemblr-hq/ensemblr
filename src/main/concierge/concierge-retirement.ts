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
 * Builds a {@link ConciergeRetirement} over the caller's close routine.
 * @param close - Closes one child and drops everything it held open.
 * @returns The tracker.
 */
export function createConciergeRetirement<TChild>(
	close: (child: TChild) => Promise<void>,
): ConciergeRetirement<TChild> {
	const retiring = new Set<TChild>();

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
		},
	};
}
