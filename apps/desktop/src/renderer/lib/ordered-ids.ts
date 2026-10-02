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
 * ids, then appends any remaining available ids in their canonical sequence.
 * Suits a drag payload, whose omissions are ids the drag did not speak for.
 * @param preferredOrder - Desired id order, typically a drag result or prior order.
 * @param availableIds - Ids that currently exist, in their canonical order.
 * @returns A deduplicated id order covering exactly the available ids.
 */
export function reconcileOrderedIds(
	preferredOrder: readonly string[],
	availableIds: readonly string[],
): string[] {
	const kept = keepAvailableIds(preferredOrder, availableIds);
	const placed = new Set(kept);

	return [...kept, ...availableIds.filter((id) => !placed.has(id))];
}

/**
 * Reconciles like {@link reconcileOrderedIds}, but slots ids the preferred order
 * omits where their canonical neighbours put them rather than at the end. The tab
 * strip renders from its own preferred order and needs this: appending would drag
 * every newly opened tab to the end of the strip no matter which position the
 * main process persisted for it.
 * @param preferredOrder - Desired id order, typically the previously rendered order.
 * @param availableIds - Ids that currently exist, in their canonical order.
 * @returns A deduplicated id order covering exactly the available ids.
 */
export function reconcileOrderedIdsByCanonicalSlot(
	preferredOrder: readonly string[],
	availableIds: readonly string[],
): string[] {
	const kept = keepAvailableIds(preferredOrder, availableIds);
	const placed = new Set(kept);

	return availableIds.reduce<string[]>((order, id, index) => {
		if (placed.has(id)) {
			return order;
		}
		placed.add(id);
		return insertAtCanonicalSlot({ availableIds, id, index, order });
	}, kept);
}

/**
 * Narrows a preferred order to the ids that still exist, keeping first occurrences
 * only so a duplicated id cannot claim two slots.
 * @param preferredOrder - Desired id order to narrow.
 * @param availableIds - Ids that currently exist.
 * @returns The preferred order minus unknown and repeated ids.
 */
function keepAvailableIds(
	preferredOrder: readonly string[],
	availableIds: readonly string[],
): string[] {
	const availableSet = new Set(availableIds);
	const seen = new Set<string>();

	return preferredOrder.filter((id) => {
		if (!availableSet.has(id) || seen.has(id)) {
			return false;
		}
		seen.add(id);
		return true;
	});
}

/**
 * Inserts an id into an order at the slot its canonical neighbours imply: right
 * after the closest id that precedes it canonically and is already placed, or at
 * the front when the order holds none of them.
 * @param options - The order to insert into, the id, and its canonical position
 * @returns A new order holding `id` at its canonical slot
 */
function insertAtCanonicalSlot({
	availableIds,
	id,
	index,
	order,
}: {
	availableIds: readonly string[];
	id: string;
	index: number;
	order: readonly string[];
}): string[] {
	for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
		const anchorIndex = order.indexOf(availableIds[cursor]);
		if (anchorIndex !== -1) {
			return [
				...order.slice(0, anchorIndex + 1),
				id,
				...order.slice(anchorIndex + 1),
			];
		}
	}
	return [id, ...order];
}
