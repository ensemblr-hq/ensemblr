/**
 * Turns an {@link ArchitectureIR} into the geometry the SVG surface draws:
 * positioned node rects, routed edge polylines with their label anchors,
 * boundary bounding boxes, and a viewBox.
 *
 * The measurement and routing rules are ported from archify's
 * `renderers/architecture/render-architecture.mjs` (MIT) — its `measureComponent`,
 * `boundaryRect`, `autoViewBoxFor`, and `pathFor`/`routeVia` ladder — with its
 * HTML emission, legend footprint, brand marks, and quality-profile expansions
 * left behind. Those shape the *artifact*; this app draws its own React tree.
 * The candidate ladder itself lives in `route-ladder.ts`.
 *
 * Pure: no DOM, no React, no measurement of real text. That is what lets the
 * whole compiler be tested under Vitest's `node` environment.
 */
import type {
	ArchitectureBoundary,
	ArchitectureComponent,
	ArchitectureConnection,
	ArchitectureIR,
	ArchitectureSide,
	DiagramPoint,
	DiagramSize,
} from '@/shared/architecture-diagram';

import { resolveComponentPos, validateGridPlacement } from './grid';
import { clearLanes } from './lanes';
import type {
	DiagramEdge,
	DiagramFrame,
	DiagramLayout,
	DiagramNode,
} from './layout-types';
import { solveOrganicLayout } from './organic';
import { routeVia, selfLoopPoints } from './route-ladder';
import {
	anchor,
	automaticPortSpread,
	chosenSide,
	defaultFromSide,
	defaultToSide,
	labelPoint,
	roundedPath,
} from './routing';
import {
	FRAME_METRICS,
	frameTitleWidth,
	PINNED_NODE_SIZE,
	type ResolvedGrid,
	resolveGridTracks,
	SOLVED_NODE_SIZE,
} from './tracks';

/** Box and canvas metrics. The frame's own live in `tracks.ts`, which reserves room for them. */
const LAYOUT = {
	cornerRadius: 8,
	margin: 40,
} as const;

export type {
	DiagramEdge,
	DiagramFrame,
	DiagramLayout,
	DiagramNode,
} from './layout-types';

/** The two boxes an edge joins, plus the diagram it has to get through. */
interface EdgeContext {
	corridors: readonly number[];
	from: DiagramNode;
	gutters: readonly number[];
	nodes: readonly DiagramNode[];
	/** Fanned-out anchors when several edges leave one side of a box. */
	spread: { from?: DiagramPoint; to?: DiagramPoint } | null;
	to: DiagramNode;
}

/**
 * Places and sizes one component.
 * @param component - The component to measure
 * @param grid - The document's resolved grid, or null under free placement
 * @returns Its measured rect
 */
function measureComponent(
	component: ArchitectureComponent,
	grid: ResolvedGrid | null,
): DiagramNode {
	return measureAt(
		component,
		resolveComponentPos(component, grid),
		component.size ?? grid?.nodeSize ?? PINNED_NODE_SIZE,
	);
}

/**
 * Builds a measured node from a corner the caller already solved, which is how
 * the organic mode places one — it computes positions itself rather than
 * resolving them out of a grid.
 * @param component - The component to measure
 * @param corner - Its top-left corner
 * @param size - Its box size
 * @returns Its measured rect
 */
function measureAt(
	component: ArchitectureComponent,
	corner: DiagramPoint,
	size: DiagramSize,
): DiagramNode {
	const [x, y] = corner;
	const [width, height] = size;
	return {
		component,
		cx: x + width / 2,
		cy: y + height / 2,
		height,
		id: component.id,
		width,
		x,
		y,
	};
}

/**
 * Sizes a boundary frame to the bounding box of the components it wraps, with
 * extra room at the top for its title band and at the bottom for optical
 * balance.
 * @param boundary - The boundary to size
 * @param nodes - Measured components, keyed by id
 * @returns The frame, or null when it wraps nothing that exists
 */
function measureBoundary(
	boundary: ArchitectureBoundary,
	nodes: ReadonlyMap<string, DiagramNode>,
): DiagramFrame | null {
	const members = boundary.wraps.flatMap((id) => {
		const node = nodes.get(id);
		return node && Number.isFinite(node.x) && Number.isFinite(node.y)
			? [node]
			: [];
	});
	if (members.length === 0) {
		return null;
	}
	const minX = Math.min(...members.map((member) => member.x));
	const minY = Math.min(...members.map((member) => member.y));
	const maxX = Math.max(...members.map((member) => member.x + member.width));
	const maxY = Math.max(...members.map((member) => member.y + member.height));
	const pad = boundary.pad ?? FRAME_METRICS.pad;
	const topPad = Math.max(
		pad,
		FRAME_METRICS.labelBaseline + FRAME_METRICS.labelClearance,
	);
	const width = maxX - minX + pad * 2;
	return {
		boundary,
		depth: 0,
		height: maxY - minY + topPad + FRAME_METRICS.extraBottom,
		id: `${boundary.kind}:${boundary.label}`,
		isLens: false,
		outline: null,
		title: {
			height: FRAME_METRICS.labelHeight,
			width: Math.max(
				0,
				Math.min(
					width - FRAME_METRICS.labelInset * 2,
					frameTitleWidth(boundary.label),
				),
			),
			x: minX - pad + FRAME_METRICS.labelInset,
			y: minY - FRAME_METRICS.labelClearance - FRAME_METRICS.labelHeight,
		},
		width,
		x: minX - pad,
		y: minY - topPad,
	};
}

/**
 * The furthest node and frame edge, which is what a canvas has to hold.
 * @param nodes - Measured components
 * @param frames - Measured boundary frames
 * @returns The content's bottom-right corner
 */
function contentBounds(
	nodes: readonly DiagramNode[],
	frames: readonly DiagramFrame[],
): DiagramSize {
	const placed = nodes.filter(
		(node) => Number.isFinite(node.x) && Number.isFinite(node.y),
	);
	return [
		Math.max(
			0,
			...placed.map((node) => node.x + node.width),
			...frames.map((frame) => frame.x + frame.width),
		),
		Math.max(
			0,
			...placed.map((node) => node.y + node.height),
			...frames.map((frame) => frame.y + frame.height),
		),
	];
}

/**
 * The canvas size, either as the document declares it or derived from the
 * furthest node and frame edge plus a margin.
 *
 * A declared box is kept verbatim even when it is too small — reproducing an
 * archify-authored document's own canvas is the point of honouring it — but a
 * box that cannot hold its own content is reported, since silent clipping is
 * indistinguishable from a diagram that simply has fewer boxes in it.
 * @param nodes - Measured components
 * @param frames - Measured boundary frames
 * @param declared - The document's `meta.viewBox`, if it has one
 * @param problems - Fault list to append to
 * @returns The viewBox dimensions
 */
function resolveViewBox(
	nodes: readonly DiagramNode[],
	frames: readonly DiagramFrame[],
	declared: DiagramSize | undefined,
	problems: string[],
): DiagramSize {
	const [contentWidth, contentHeight] = contentBounds(nodes, frames);
	if (!declared) {
		return [
			Math.ceil(contentWidth + LAYOUT.margin),
			Math.ceil(contentHeight + LAYOUT.margin),
		];
	}
	if (declared[0] < contentWidth || declared[1] < contentHeight) {
		problems.push(
			`Declared meta.viewBox ${declared[0]}x${declared[1]} is smaller than the ${Math.ceil(contentWidth)}x${Math.ceil(contentHeight)} its content fills; the rest is clipped.`,
		);
	}
	return declared;
}

/**
 * Compiles a document into drawable geometry, in whichever mode it declares.
 *
 * The two modes share their node measurement, their reference checking, and
 * their viewBox, and nothing else: the grid resolves cells into coordinates and
 * routes orthogonally, the organic mode solves an Euler packing and draws
 * curves. Keeping them apart is what lets a document archify authored still
 * compile to archify's own geometry.
 * @param ir - The architecture IR to lay out
 * @returns The nodes, edges, frames, viewBox, and any faults found on the way
 */
export function compileArchitectureLayout(ir: ArchitectureIR): DiagramLayout {
	return ir.layout?.mode === 'organic' ? compileOrganic(ir) : compileGrid(ir);
}

/**
 * Every connection whose endpoints exist and are placed, reporting the ones
 * that name a component the document does not hold.
 * @param ir - The document being laid out
 * @param nodeById - Measured components, keyed by id
 * @param problems - Fault list to append to
 * @returns The connections worth routing
 */
function routableConnections(
	ir: ArchitectureIR,
	nodeById: ReadonlyMap<string, DiagramNode>,
	problems: string[],
): readonly ArchitectureConnection[] {
	return (ir.connections ?? []).filter((connection) => {
		const from = nodeById.get(connection.from);
		const to = nodeById.get(connection.to);
		if (!from || !to) {
			problems.push(
				`Connection "${connection.id}" references a component that does not exist.`,
			);
			return false;
		}
		return Number.isFinite(from.x) && Number.isFinite(to.x);
	});
}

/**
 * The sides an edge leaves and arrives through: whatever it names, and otherwise
 * whichever sides face each other.
 * @param connection - The edge being routed
 * @param from - Source box
 * @param to - Target box
 * @returns The two sides
 */
function sidesFor(
	connection: ArchitectureConnection,
	from: DiagramNode,
	to: DiagramNode,
): { fromSide: ArchitectureSide; toSide: ArchitectureSide } {
	return {
		fromSide: chosenSide(connection.fromSide, defaultFromSide(from, to)),
		toSide: chosenSide(connection.toSide, defaultToSide(from, to)),
	};
}

/**
 * The side resolver the port spread is driven by, bound to one document's
 * measured boxes.
 * @param nodeById - Measured components, keyed by id
 * @returns A resolver from connection to its two sides
 */
function sideResolver(nodeById: ReadonlyMap<string, DiagramNode>): (
	connection: ArchitectureConnection,
) => {
	fromSide: ArchitectureSide;
	toSide: ArchitectureSide;
} {
	return (connection) =>
		sidesFor(
			connection,
			nodeById.get(connection.from) as DiagramNode,
			nodeById.get(connection.to) as DiagramNode,
		);
}

/**
 * The route one edge takes, as a whole point list.
 * @param connection - The edge being routed
 * @param context - The two boxes, the diagram around them, and its clear lanes
 * @returns The route, endpoints included
 */
function edgePoints(
	connection: ArchitectureConnection,
	context: EdgeContext,
): readonly DiagramPoint[] {
	const { from, spread, to } = context;
	if (connection.from === connection.to && !connection.via) {
		return selfLoopPoints(from);
	}
	const { fromSide, toSide } = sidesFor(connection, from, to);
	const start = spread?.from ?? anchor(from, fromSide);
	const end = spread?.to ?? anchor(to, toSide);
	return [
		start,
		...routeVia({ ...context, connection, end, fromSide, start, toSide }),
		end,
	];
}

/**
 * An edge routed through the clear lanes between the boxes.
 *
 * An arrow crossing a box it has nothing to do with reads as a connection to
 * that box, so every edge navigates rather than taking the direct line. Both
 * modes route through this: the packer lays a region's nodes out in rows, which
 * leaves the same lanes the grid's tracks do.
 * @param connection - The edge being routed
 * @param context - The two boxes, the diagram around them, and its clear lanes
 * @returns The routed edge, with its corners rounded
 */
function routedEdge(
	connection: ArchitectureConnection,
	context: EdgeContext,
): DiagramEdge {
	const points = edgePoints(connection, context);
	return {
		connection,
		d: roundedPath(points, LAYOUT.cornerRadius),
		id: connection.id,
		labelAt: connection.label ? labelPoint(connection, points) : null,
		points,
	};
}

/**
 * Routes every connection in a compiled document, spreading the anchors that
 * would otherwise stack on one box side.
 * @param routable - The connections worth routing
 * @param nodeById - Measured components, keyed by id
 * @param nodes - Every measured component, for the clear lanes and collisions
 * @returns One routed edge per connection, in document order
 */
function routeEdges(
	routable: readonly ArchitectureConnection[],
	nodeById: ReadonlyMap<string, DiagramNode>,
	nodes: readonly DiagramNode[],
): readonly DiagramEdge[] {
	const ports = automaticPortSpread(routable, nodeById, sideResolver(nodeById));
	const corridors = clearLanes(nodes, 'x');
	const gutters = clearLanes(nodes, 'y');
	return routable.map((connection) =>
		routedEdge(connection, {
			corridors,
			from: nodeById.get(connection.from) as DiagramNode,
			gutters,
			nodes,
			spread: ports.get(connection.id) ?? null,
			to: nodeById.get(connection.to) as DiagramNode,
		}),
	);
}

/**
 * Reports a boundary none of whose members exist, which would otherwise be
 * dropped without a word.
 * @param ir - The document being laid out
 * @param placedIds - Ids the document actually holds
 * @param problems - Fault list to append to
 */
function reportEmptyBoundaries(
	ir: ArchitectureIR,
	placedIds: ReadonlySet<string>,
	problems: string[],
): void {
	for (const boundary of ir.boundaries ?? []) {
		if (!boundary.wraps.some((id) => placedIds.has(id))) {
			problems.push(
				`Boundary "${boundary.label}" wraps no component that exists.`,
			);
		}
	}
}

/**
 * Reports authored placement the organic solver cannot honour.
 *
 * The schema accepts `pos`, `row`, and `col` in every mode, so a document that
 * carries them into organic mode is accepted and then packed by containment
 * instead — which looks like the fields were misread rather than overridden.
 * @param components - The document's components
 * @param problems - Fault list to append to
 */
function reportIgnoredPlacement(
	components: readonly ArchitectureComponent[],
	problems: string[],
): void {
	for (const component of components) {
		const declared = [
			...(component.pos ? ['pos'] : []),
			...(component.row !== undefined || component.col !== undefined
				? ['row/col']
				: []),
		];
		if (declared.length > 0) {
			problems.push(
				`Component "${component.id}" declares ${declared.join(' and ')}, which organic layout ignores.`,
			);
		}
	}
}

/**
 * Compiles an Euler document: positions and frames from the organic solver,
 * connections as curves between the boxes it placed.
 * @param ir - The document to lay out
 * @returns The compiled layout
 */
function compileOrganic(ir: ArchitectureIR): DiagramLayout {
	const solution = solveOrganicLayout(ir);
	const problems = [...solution.problems];
	reportIgnoredPlacement(ir.components, problems);
	reportEmptyBoundaries(
		ir,
		new Set(ir.components.map((component) => component.id)),
		problems,
	);

	const nodes = ir.components.map((component) =>
		measureAt(
			component,
			solution.positions.get(component.id) ?? [Number.NaN, Number.NaN],
			component.size ?? SOLVED_NODE_SIZE,
		),
	);
	const nodeById = new Map(nodes.map((node) => [node.id, node]));
	const edges = routeEdges(
		routableConnections(ir, nodeById, problems),
		nodeById,
		nodes,
	);

	return {
		edges,
		frames: solution.frames,
		nodes,
		problems,
		viewBox: resolveViewBox(nodes, solution.frames, ir.meta.viewBox, problems),
	};
}

/**
 * Compiles a grid or free-placement document, which is archify's own geometry.
 * @param ir - The document to lay out
 * @returns The compiled layout
 */
function compileGrid(ir: ArchitectureIR): DiagramLayout {
	const grid = resolveGridTracks(ir);
	const problems = [...validateGridPlacement(ir, grid)];
	const nodes = ir.components.map((component) =>
		measureComponent(component, grid),
	);
	const nodeById = new Map(nodes.map((node) => [node.id, node]));
	const frames = (ir.boundaries ?? []).flatMap((boundary) => {
		const frame = measureBoundary(boundary, nodeById);
		if (!frame) {
			problems.push(
				`Boundary "${boundary.label}" wraps no component that exists.`,
			);
			return [];
		}
		return [frame];
	});
	const edges = routeEdges(
		routableConnections(ir, nodeById, problems),
		nodeById,
		nodes,
	);

	return {
		edges,
		frames,
		nodes,
		problems,
		viewBox: resolveViewBox(nodes, frames, ir.meta.viewBox, problems),
	};
}
