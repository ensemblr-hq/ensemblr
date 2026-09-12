/**
 * Pairs each item of a rendered list with a React key drawn from what the item
 * holds rather than from where it sits.
 *
 * Content alone is not unique — a recursive traceback repeats a frame verbatim,
 * two language-server diagnostics can agree on every field, and one message can
 * reference the same folder twice — so a repeat is told apart by how many
 * identical items came before it. That ordinal is stable across renders for an
 * unchanged list, which the array index is not: an item prepended to the list
 * renumbers every key after it and React reuses the wrong element's state.
 * @param items - The list about to be rendered, in render order
 * @param identify - What an item is, as a string; equal strings mean equal content
 * @returns The same items in the same order, each with a key unique among its siblings
 */
export function withListKeys<Item>(
	items: readonly Item[],
	identify: (item: Item) => string,
): readonly { item: Item; key: string }[] {
	const occurrences = new Map<string, number>();
	return items.map((item) => {
		const identity = identify(item);
		const seen = occurrences.get(identity) ?? 0;
		occurrences.set(identity, seen + 1);
		return { item, key: `${identity}#${seen}` };
	});
}
