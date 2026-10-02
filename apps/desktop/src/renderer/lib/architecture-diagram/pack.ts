/**
 * Packs boxes into rows, recursively, with no simulation.
 *
 * A region is packed bottom-up: its child regions are packed first and each
 * collapses to one rigid box, then those boxes and the region's own nodes are
 * laid out left to right in rows, wrapping at a width chosen to keep the cluster
 * roughly as wide as it is tall.
 *
 * Rows rather than a spiral, because the edges have to be routable. Nodes are
 * almost always the same size, so a row layout puts them on shared columns — and
 * the clear vertical and horizontal lanes that leaves between them are exactly
 * what the orthogonal router turns into when it has to get past a box. A spiral
 * packs tighter and leaves no lane anywhere, which is why every long edge ended
 * up drawn straight through whatever sat in the way.
 *
 * Determinism is the other reason. A force simulation settles somewhere slightly
 * different every time its input changes, and the delta comparator would then
 * report every node in the diagram as moved on every rebuild. Rows have no
 * randomness: the same items in the same order land on the same pixels.
 */

/** Spacing and shape the packer lays out against. */
const PACK = {
	/**
	 * Clear space kept between any two placed boxes, which is what becomes the
	 * lanes the router turns into.
	 *
	 * Wider than it looks like it needs to be, because the lanes are found from
	 * the projection of *every* box in the diagram: two islands side by side each
	 * fill the gaps the other leaves, so an island-local gap does not survive as a
	 * global lane. Measured on this repository's own diagram — 120 edges over 48
	 * nodes — 36 left four edges with no clear route and 52 left none.
	 */
	gap: 52,
	/** How much wider than tall a cluster of plain nodes aims to be. */
	targetAspect: 1.7,
	/**
	 * Clear space kept between two islands, and how much wider than tall a row of
	 * them aims to be.
	 *
	 * Islands are the level a reader navigates by, so they are laid out across
	 * rather than stacked: a wide target keeps sibling regions on one row until
	 * the row is genuinely too long, and the larger gap keeps their outlines from
	 * reading as one shape.
	 */
	islandAspect: 4,
	islandGap: 104,
} as const;

/** A box waiting to be placed, identified by whatever the caller packs. */
export interface PackItem {
	height: number;
	id: string;
	/** Lower sorts first, which is how members of one lens are kept adjacent. */
	rank: number;
	width: number;
}

/** Where a packed item ended up, as a top-left corner. */
export interface PackPlacement {
	height: number;
	id: string;
	width: number;
	x: number;
	y: number;
}

/** A packed cluster: its placements and the box that encloses them. */
export interface PackResult {
	height: number;
	placements: readonly PackPlacement[];
	width: number;
}

/**
 * The width a cluster wraps at: wide enough for its own widest box, and
 * otherwise sized so the rows come out roughly square overall.
 * @param items - The boxes to be packed
 * @param gap - Clear space between boxes
 * @returns The wrap width
 */
function wrapWidth(
	items: readonly PackItem[],
	gap: number,
	aspect: number,
): number {
	const area = items.reduce(
		(total, item) => total + (item.width + gap) * (item.height + gap),
		0,
	);
	const widest = Math.max(...items.map((item) => item.width));
	return Math.max(widest, Math.sqrt(area * aspect));
}

/**
 * Packs a set of boxes into rows and reports where each landed relative to the
 * cluster's own top-left corner.
 *
 * Items are ordered by rank, then tallest first, so boxes of a like height share
 * a row and a row of same-size nodes comes out on aligned columns. Ties break on
 * id by code unit rather than by collation: `localeCompare` follows the host's
 * ICU default, and a locale that orders two ids the other way round would move
 * every node downstream of them and report the whole diagram as changed.
 * @param items - The boxes to pack
 * @param holdsIslands - True when the items are regions rather than plain nodes,
 * which are spread across a wider row and given more room between them
 * @returns The placements and the size of the cluster they fill
 */
export function packCluster(
	items: readonly PackItem[],
	holdsIslands = false,
): PackResult {
	if (items.length === 0) {
		return { height: 0, placements: [], width: 0 };
	}
	const gap = holdsIslands ? PACK.islandGap : PACK.gap;
	const aspect = holdsIslands ? PACK.islandAspect : PACK.targetAspect;
	const ordered = [...items].sort((left, right) => {
		const byRank = left.rank - right.rank;
		if (byRank !== 0) {
			return byRank;
		}
		const byHeight = right.height - left.height;
		if (byHeight !== 0) {
			return byHeight;
		}
		const byWidth = right.width - left.width;
		return byWidth !== 0 ? byWidth : left.id < right.id ? -1 : 1;
	});

	const limit = wrapWidth(ordered, gap, aspect);
	const placements: PackPlacement[] = [];
	let cursorX = 0;
	let rowTop = 0;
	let rowHeight = 0;

	for (const item of ordered) {
		if (cursorX > 0 && cursorX + item.width > limit) {
			rowTop += rowHeight + gap;
			cursorX = 0;
			rowHeight = 0;
		}
		placements.push({
			height: item.height,
			id: item.id,
			width: item.width,
			x: cursorX,
			y: rowTop,
		});
		cursorX += item.width + gap;
		rowHeight = Math.max(rowHeight, item.height);
	}

	return {
		height: rowTop + rowHeight,
		placements,
		width: Math.max(...placements.map((entry) => entry.x + entry.width)),
	};
}
