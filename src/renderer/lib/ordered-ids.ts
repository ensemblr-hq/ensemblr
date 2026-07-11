/**
 * Order-sensitive shallow equality for two string-id arrays.
 * @param first - Left-hand id sequence.
 * @param second - Right-hand id sequence.
 * @returns True when both arrays hold the same ids in the same order.
 */
export function areStringArraysEqual(
	first: readonly string[],
	second: readonly string[],
): boolean {
	return (
		first.length === second.length &&
		first.every((value, index) => value === second[index])
	);
}

/**
 * Reconciles a preferred id order against the set of currently available ids:
 * keeps the preferred order for ids that still exist, drops unknown or duplicate
 * ids, then appends any remaining available ids in their original sequence.
 * @param preferredOrder - Desired id order, typically a drag result or prior order.
 * @param availableIds - Ids that currently exist, in their canonical order.
 * @returns A deduplicated id order covering exactly the available ids.
 */
export function reconcileOrderedIds(
	preferredOrder: readonly string[],
	availableIds: readonly string[],
): string[] {
	const availableSet = new Set(availableIds);
	const seen = new Set<string>();
	const kept = preferredOrder.filter((id) => {
		if (!availableSet.has(id) || seen.has(id)) {
			return false;
		}
		seen.add(id);
		return true;
	});
	const trailing = availableIds.filter((id) => !seen.has(id));

	return [...kept, ...trailing];
}
