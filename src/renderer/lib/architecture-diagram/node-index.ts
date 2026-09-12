/**
 * A uniform-grid bucket index over the placed components, so testing a route
 * segment for clearance costs the handful of boxes near it rather than all of
 * them.
 *
 * The candidate ladder in `route-ladder.ts` is generate-and-test, and the test
 * was `nodes.every(...)` per segment per candidate per edge — so the work grew
 * as `edges × candidates × segments × nodes`, and a document with a hundred
 * boxes spent seconds of blocked main thread on cross products against boxes
 * nowhere near the segment being tested.
 *
 * The index is keyed on the node array's identity, which `compile.ts` hands to
 * every edge of one compile, so it is built once per diagram rather than once
 * per edge.
 */

import type { DiagramNode } from './layout-types';

/** Smallest bucket edge, so a degenerate diagram cannot produce a huge grid. */
const MINIMUM_CELL_PX = 64;

/** Cap on buckets per axis, which bounds memory for a very wide diagram. */
const MAX_CELLS_PER_AXIS = 256;

/** A grid of node buckets over the diagram's bounding box. */
export interface NodeIndex {
	/**
	 * Every node whose bucket the query rectangle touches. A superset of the
	 * nodes that actually overlap it — callers still run their exact test.
	 * @param minX - Left edge of the query rectangle
	 * @param minY - Top edge of the query rectangle
	 * @param maxX - Right edge of the query rectangle
	 * @param maxY - Bottom edge of the query rectangle
	 * @returns The candidate nodes, each at most once
	 */
	near: (
		minX: number,
		minY: number,
		maxX: number,
		maxY: number,
	) => readonly DiagramNode[];
}

const indexCache = new WeakMap<readonly DiagramNode[], NodeIndex>();

/** Reports whether a node was given a finite position by the solver. */
function isPlaced(node: DiagramNode): boolean {
	return Number.isFinite(node.x) && Number.isFinite(node.y);
}

/**
 * Answers every query with the whole set, for a diagram too small or too
 * degenerate for bucketing to pay for itself.
 * @param nodes - The nodes to return from every query
 * @returns An index that never narrows
 */
function wholeSetIndex(nodes: readonly DiagramNode[]): NodeIndex {
	return { near: () => nodes };
}

/**
 * Builds the bucket grid.
 * @param nodes - Every measured component, placed or not
 * @returns An index over the placed ones
 */
function buildIndex(nodes: readonly DiagramNode[]): NodeIndex {
	const placed = nodes.filter(isPlaced);

	if (placed.length < 16) {
		return wholeSetIndex(nodes);
	}

	const minX = Math.min(...placed.map((node) => node.x));
	const minY = Math.min(...placed.map((node) => node.y));
	const maxX = Math.max(...placed.map((node) => node.x + node.width));
	const maxY = Math.max(...placed.map((node) => node.y + node.height));
	const spanX = maxX - minX;
	const spanY = maxY - minY;

	if (!(spanX > 0 && spanY > 0)) {
		return wholeSetIndex(nodes);
	}

	// One bucket per node on average, which keeps a query's candidate set small
	// without making the grid itself the cost.
	const cell = Math.max(
		MINIMUM_CELL_PX,
		Math.sqrt((spanX * spanY) / placed.length),
	);
	const columns = Math.min(MAX_CELLS_PER_AXIS, Math.ceil(spanX / cell) + 1);
	const rows = Math.min(MAX_CELLS_PER_AXIS, Math.ceil(spanY / cell) + 1);
	const columnOf = (x: number) =>
		Math.min(columns - 1, Math.max(0, Math.floor((x - minX) / cell)));
	const rowOf = (y: number) =>
		Math.min(rows - 1, Math.max(0, Math.floor((y - minY) / cell)));
	const buckets: DiagramNode[][] = Array.from(
		{ length: columns * rows },
		() => [],
	);
	// Nodes the solver never placed sit in no bucket, so they are returned from
	// every query — the clearance test skips them anyway, and dropping them here
	// would change which nodes a caller sees.
	const unplaced = nodes.filter((node) => !isPlaced(node));

	for (const node of placed) {
		const lastColumn = columnOf(node.x + node.width);
		const lastRow = rowOf(node.y + node.height);
		for (let column = columnOf(node.x); column <= lastColumn; column += 1) {
			for (let row = rowOf(node.y); row <= lastRow; row += 1) {
				buckets[row * columns + column]?.push(node);
			}
		}
	}

	return {
		near: (queryMinX, queryMinY, queryMaxX, queryMaxY) => {
			const found = new Set(unplaced);
			const lastColumn = columnOf(queryMaxX);
			const lastRow = rowOf(queryMaxY);

			for (
				let column = columnOf(queryMinX);
				column <= lastColumn;
				column += 1
			) {
				for (let row = rowOf(queryMinY); row <= lastRow; row += 1) {
					for (const node of buckets[row * columns + column] ?? []) {
						found.add(node);
					}
				}
			}

			return [...found];
		},
	};
}

/**
 * The bucket index for a node array, built once and reused for every edge of
 * the same compile.
 * @param nodes - Every measured component of one diagram
 * @returns The index over them
 */
export function nodeIndexFor(nodes: readonly DiagramNode[]): NodeIndex {
	const cached = indexCache.get(nodes);

	if (cached) {
		return cached;
	}

	const index = buildIndex(nodes);
	indexCache.set(nodes, index);
	return index;
}
