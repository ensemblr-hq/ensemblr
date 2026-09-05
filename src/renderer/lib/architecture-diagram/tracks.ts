/**
 * Solves the pixel geometry a grid document's `row`/`col` resolve against.
 *
 * archify's grid is uniform: every cell is `cellW × cellH` and every gap is the
 * same. That is right for a hand-authored document of nine boxes and wrong for
 * a scanned one of fifty, where a row gap has to clear two boundary frames and
 * carry the edges crossing between the bands. The seeded document declares only
 * `mode` and `cols`, so it inherits whatever this module decides.
 *
 * A document that pins any cell dimension is taken at its word and gets the
 * uniform geometry it asked for — an author who set `cellW` is placing boxes,
 * not asking for advice.
 */
import type {
	ArchitectureBoundary,
	ArchitectureComponent,
	ArchitectureIR,
	ArchitectureLayout,
	DiagramPoint,
} from '@/shared/architecture-diagram';

import { textUnits } from './text-fit';

/**
 * Frame metrics, shared with the boundary measurement in `compile.ts` so the
 * clearance a seam reserves and the frame drawn into it cannot drift apart.
 */
export const FRAME_METRICS = {
	extraBottom: 20,
	labelBaseline: 18,
	labelClearance: 4,
	labelHeight: 16,
	labelInset: 4,
	pad: 30,
} as const;

/**
 * Most tracks either axis may be solved for, whatever index a component names.
 *
 * A track is an array entry and a pixel offset, so the count is the compiler's
 * only allocation that scales with a number the document chose rather than with
 * how much the document contains. Left unbounded, `col: 50000000` froze the
 * renderer's main thread for seconds and `row: 2147483648` aborted the process
 * inside V8's allocator, which no error boundary can catch. A document past
 * this ceiling is drawn as far as the ceiling reaches and the components beyond
 * it are reported by {@link validateGridPlacement}.
 */
export const MAX_GRID_TRACKS = 512;

/**
 * Width a frame's title band reserves.
 *
 * Measured in advance width rather than code units: a CJK label is two columns
 * per character and an emoji label wider still, so `label.length` sizes the
 * band at half the drawn width for one and double it for the other.
 * @param label - The boundary's label
 * @returns The band's width in pixels
 */
export function frameTitleWidth(label: string): number {
	return textUnits(label) * 5 + 10;
}

/** Room above a frame's first member row, which has to clear its title band. */
const FRAME_TOP_PAD = Math.max(
	FRAME_METRICS.pad,
	FRAME_METRICS.labelBaseline + FRAME_METRICS.labelClearance,
);

/** Track sizing and seam budget for a document that declares no cell geometry. */
const SOLVED = {
	baseGapX: 56,
	baseGapY: 48,
	edgesPerChannel: 4,
	frameSeparation: 14,
	maxChannel: 84,
	minTrackH: 76,
	minTrackW: 168,
	channelPitch: 14,
} as const;

/**
 * Box size a component inherits under solved tracks, which size themselves to
 * fit it. Bigger than archify's because the scanner writes real path sublabels
 * — `src/renderer/components` shrinks to the 6px floor inside a 120px box.
 */
export const SOLVED_NODE_SIZE = [168, 76] as const satisfies DiagramPoint;

/**
 * Box size archify's renderer uses, which a document that pinned its own cell
 * geometry keeps: its author placed boxes against this size, and growing them
 * underneath would spill each one out of the cell it was drawn for.
 */
export const PINNED_NODE_SIZE = [120, 60] as const satisfies DiagramPoint;

/**
 * Every grid dimension, plus the solved track offsets a component's cell maps
 * onto. `colX[n]` is column `n`'s left edge and `rowY[n]` its row's top edge.
 */
export interface ResolvedGrid {
	cellH: number;
	cellW: number;
	colX: readonly number[];
	cols: number;
	gapX: number;
	gapY: number;
	mode: 'grid';
	/** Size a component on these tracks inherits when it declares none. */
	nodeSize: DiagramPoint;
	origin: DiagramPoint;
	rowY: readonly number[];
}

/** The uniform cell geometry archify's renderer uses, kept as the pinned mode's defaults. */
const DEFAULT_GRID = {
	cellH: 64,
	cellW: 130,
	cols: 4,
	gapX: 30,
	gapY: 40,
	mode: 'grid',
	nodeSize: PINNED_NODE_SIZE,
	origin: [40, 80],
} as const satisfies Omit<ResolvedGrid, 'colX' | 'rowY'>;

/**
 * True when the document pins its own cell geometry, which the solver leaves
 * alone. Any one of the four dimensions counts: a document that set `cellW`
 * chose its column pitch, and widening its rows underneath it would move boxes
 * the author placed.
 * @param layout - The IR's `layout` block
 * @returns True when the uniform geometry should be used verbatim
 */
function declaresCellGeometry(layout: ArchitectureLayout): boolean {
	return (
		layout.cellH !== undefined ||
		layout.cellW !== undefined ||
		layout.gapX !== undefined ||
		layout.gapY !== undefined
	);
}

/** A component's cell, for components that are placed by one. */
interface Cell {
	col: number;
	row: number;
}

/**
 * The cell a component occupies, or null when it is placed by an explicit
 * `pos` or names no cell at all.
 * @param component - The component to read
 * @returns Its cell, or null when it is not grid-placed
 */
function cellOf(component: ArchitectureComponent): Cell | null {
	if (component.pos) {
		return null;
	}
	if (!Number.isInteger(component.row) || !Number.isInteger(component.col)) {
		return null;
	}
	return { col: component.col as number, row: component.row as number };
}

/**
 * Largest index used along one axis, so a component sitting outside the
 * declared `cols` still lands on a track rather than off the end of the array —
 * bounded by {@link MAX_GRID_TRACKS}, because the index comes from the document
 * and the allocation must not.
 * @param cells - Every grid-placed cell
 * @param axis - Which index to take
 * @param declared - Lower bound from the document, as a count
 * @returns The number of tracks to solve
 */
function trackCount(
	cells: readonly Cell[],
	axis: 'col' | 'row',
	declared: number,
): number {
	const highest = cells.reduce(
		(largest, cell) => Math.max(largest, cell[axis]),
		-1,
	);
	return Math.min(MAX_GRID_TRACKS, Math.max(declared, highest + 1));
}

/**
 * Solves one axis's track sizes from the components sitting on it.
 *
 * A cell outside the solved range is skipped rather than written: the index
 * comes from the document, and writing past the end grows the array to that
 * index — which is the same unbounded allocation {@link MAX_GRID_TRACKS} exists
 * to prevent. Those components are reported by `validateGridPlacement` and land
 * on no track.
 * @param components - Every component, with the cell each occupies
 * @param count - How many tracks the axis has
 * @param axis - Which index selects the track
 * @param extent - Which of a component's dimensions fills the track
 * @param minimum - Smallest track the axis may produce
 * @returns One size per track, in index order
 */
function solveTrackSizes(
	components: readonly { cell: Cell; size: DiagramPoint }[],
	count: number,
	axis: 'col' | 'row',
	extent: 0 | 1,
	minimum: number,
): number[] {
	const sizes = Array.from({ length: count }, () => minimum);
	for (const { cell, size } of components) {
		const index = cell[axis];
		if (index < 0 || index >= count) {
			continue;
		}
		sizes[index] = Math.max(sizes[index] ?? minimum, size[extent]);
	}
	return sizes;
}

/**
 * Rows a boundary's members occupy, which is what decides whether its frame
 * edge falls on a given seam.
 * @param boundary - The boundary to read
 * @param cellById - Cell each component id occupies
 * @returns The set of rows the frame spans
 */
function boundaryRows(
	boundary: ArchitectureBoundary,
	cellById: ReadonlyMap<string, Cell>,
): ReadonlySet<number> {
	const rows = new Set<number>();
	for (const id of boundary.wraps) {
		const cell = cellById.get(id);
		if (cell) {
			rows.add(cell.row);
		}
	}
	return rows;
}

/**
 * Vertical room a seam has to reserve so the frames meeting there cannot
 * overlap: the outgoing frame's bottom, the incoming frame's title band, and a
 * separation between them when both fall on the same seam.
 * @param seam - Index of the row above the seam
 * @param frames - Row sets of every boundary in the document
 * @returns The pixels the seam owes to boundary frames
 */
function frameClearanceAt(
	seam: number,
	frames: readonly ReadonlySet<number>[],
): number {
	const endsHere = frames.some((rows) => maxRow(rows) === seam);
	const startsHere = frames.some((rows) => minRow(rows) === seam + 1);
	if (!endsHere && !startsHere) {
		return 0;
	}
	const below = endsHere ? FRAME_METRICS.extraBottom : 0;
	const above = startsHere ? FRAME_TOP_PAD : 0;
	const separation = endsHere && startsHere ? SOLVED.frameSeparation : 0;
	return below + above + separation;
}

/**
 * Smallest row in a set.
 * @param rows - The rows to scan
 * @returns The lowest index
 */
function minRow(rows: ReadonlySet<number>): number {
	return Math.min(...rows);
}

/**
 * Largest row in a set.
 * @param rows - The rows to scan
 * @returns The highest index
 */
function maxRow(rows: ReadonlySet<number>): number {
	return Math.max(...rows);
}

/**
 * Vertical room a seam has to reserve for the edges running across it, so a
 * dense band gets a routing channel and a sparse one stays tight.
 * @param seam - Index of the row above the seam
 * @param spans - Row pairs of every connection between two grid-placed nodes
 * @returns The pixels the seam owes to edge traffic
 */
function channelAt(
	seam: number,
	spans: readonly { high: number; low: number }[],
): number {
	const crossings = spans.filter(
		(span) => span.low <= seam && seam < span.high,
	).length;
	return Math.min(
		SOLVED.maxChannel,
		Math.floor(crossings / SOLVED.edgesPerChannel) * SOLVED.channelPitch,
	);
}

/**
 * Turns track sizes and the gaps between them into the offset each track
 * starts at.
 * @param sizes - Track sizes in index order
 * @param origin - Offset the first track starts at
 * @param gapBefore - Gap to place ahead of the track at that index
 * @returns One offset per track
 */
function toOffsets(
	sizes: readonly number[],
	origin: number,
	gapBefore: (index: number) => number,
): number[] {
	const offsets: number[] = [];
	let cursor = origin;
	for (const [index, size] of sizes.entries()) {
		cursor += index === 0 ? 0 : gapBefore(index);
		offsets.push(cursor);
		cursor += size;
	}
	return offsets;
}

/**
 * Builds the uniform tracks a document that pinned its cell geometry asked
 * for, which reproduce archify's `origin + index * (cell + gap)` exactly.
 * @param grid - The document's declared dimensions, defaults filled in
 * @param colCount - How many columns to emit
 * @param rowCount - How many rows to emit
 * @returns The grid with its track offsets
 */
function uniformTracks(
	grid: Omit<ResolvedGrid, 'colX' | 'rowY'>,
	colCount: number,
	rowCount: number,
): ResolvedGrid {
	return {
		...grid,
		colX: Array.from(
			{ length: colCount },
			(_, index) => grid.origin[0] + index * (grid.cellW + grid.gapX),
		),
		rowY: Array.from(
			{ length: rowCount },
			(_, index) => grid.origin[1] + index * (grid.cellH + grid.gapY),
		),
	};
}

/**
 * Resolves the document's grid: the uniform one it declared, or tracks solved
 * from its own content when it left the geometry open.
 * @param ir - The document being laid out
 * @returns The resolved grid, or null for a free-placement document
 */
export function resolveGridTracks(ir: ArchitectureIR): ResolvedGrid | null {
	const layout = ir.layout;
	if (layout?.mode !== 'grid') {
		return null;
	}
	const declared = { ...DEFAULT_GRID, ...layout, mode: 'grid' as const };
	const placed = ir.components.flatMap((component) => {
		const cell = cellOf(component);
		return cell
			? [{ cell, size: (component.size ?? SOLVED_NODE_SIZE) as DiagramPoint }]
			: [];
	});
	const cells = placed.map((entry) => entry.cell);
	const colCount = trackCount(cells, 'col', declared.cols);
	const rowCount = trackCount(cells, 'row', 1);

	if (declaresCellGeometry(layout)) {
		return uniformTracks(declared, colCount, rowCount);
	}

	const colSizes = solveTrackSizes(
		placed,
		colCount,
		'col',
		0,
		SOLVED.minTrackW,
	);
	const rowSizes = solveTrackSizes(
		placed,
		rowCount,
		'row',
		1,
		SOLVED.minTrackH,
	);
	const cellById = new Map(
		ir.components.flatMap((component) => {
			const cell = cellOf(component);
			return cell ? ([[component.id, cell]] as const) : [];
		}),
	);
	const frames = (ir.boundaries ?? []).map((boundary) =>
		boundaryRows(boundary, cellById),
	);
	const spans = (ir.connections ?? []).flatMap((connection) => {
		const from = cellById.get(connection.from);
		const to = cellById.get(connection.to);
		if (!from || !to || from.row === to.row) {
			return [];
		}
		return [
			{
				high: Math.max(from.row, to.row),
				low: Math.min(from.row, to.row),
			},
		];
	});

	return {
		...declared,
		colX: toOffsets(colSizes, declared.origin[0], () => SOLVED.baseGapX),
		nodeSize: SOLVED_NODE_SIZE,
		rowY: toOffsets(
			rowSizes,
			declared.origin[1],
			(index) =>
				Math.max(SOLVED.baseGapY, frameClearanceAt(index - 1, frames)) +
				channelAt(index - 1, spans),
		),
	};
}
