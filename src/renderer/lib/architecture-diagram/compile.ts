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
import { clearLanes, nearestLane } from './lanes';
import type {
	DiagramEdge,
	DiagramFrame,
	DiagramLayout,
	DiagramNode,
} from './layout-types';
import { solveOrganicLayout } from './organic';
import {
	anchor,
	automaticPortRhythmBridge,
	automaticPortSpread,
	chosenSide,
	collinearBacktrack,
	defaultFromSide,
	defaultToSide,
	isVerticalSide,
	labelPoint,
	type MeasuredRect,
	normalizeRoutePoints,
	roundedPath,
	routeHonorsEndpointSides,
	segmentIntersectsRect,
} from './routing';
import {
	FRAME_METRICS,
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

/** Shortest stub the automatic router will fall back to when doglegging. */
const MINIMUM_STUB_PX = 8;

/** How far a lane route leaves its endpoint before turning into the lane. */
const LANE_STUB = 12;

export type {
	DiagramEdge,
	DiagramFrame,
	DiagramLayout,
	DiagramNode,
} from './layout-types';

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
					boundary.label.length * 5 + 10,
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
 * The canvas size, either as the document declares it or derived from the
 * furthest node and frame edge plus a margin.
 * @param nodes - Measured components
 * @param frames - Measured boundary frames
 * @param declared - The document's `meta.viewBox`, if it has one
 * @returns The viewBox dimensions
 */
function resolveViewBox(
	nodes: readonly DiagramNode[],
	frames: readonly DiagramFrame[],
	declared: DiagramSize | undefined,
): DiagramSize {
	if (declared) {
		return declared;
	}
	const placed = nodes.filter(
		(node) => Number.isFinite(node.x) && Number.isFinite(node.y),
	);
	const maxX = Math.max(
		0,
		...placed.map((node) => node.x + node.width),
		...frames.map((frame) => frame.x + frame.width),
	);
	const maxY = Math.max(
		0,
		...placed.map((node) => node.y + node.height),
		...frames.map((frame) => frame.y + frame.height),
	);
	return [Math.ceil(maxX + LAYOUT.margin), Math.ceil(maxY + LAYOUT.margin)];
}

/**
 * True when no component other than the edge's own endpoints sits on the route.
 * @param connection - The edge being routed
 * @param points - The candidate route
 * @param nodes - Every measured component
 * @returns True when the route is clear
 */
function routeClearsComponents(
	connection: ArchitectureConnection,
	points: readonly DiagramPoint[],
	nodes: readonly DiagramNode[],
): boolean {
	const endpointIds = new Set([connection.from, connection.to]);
	return nodes.every((node) => {
		if (endpointIds.has(node.id) || !Number.isFinite(node.x)) {
			return true;
		}
		for (let index = 0; index < points.length - 1; index += 1) {
			if (
				segmentIntersectsRect(
					points[index] as DiagramPoint,
					points[index + 1] as DiagramPoint,
					node,
					2,
				)
			) {
				return false;
			}
		}
		return true;
	});
}

/**
 * True when the route does not re-enter its own source or target box after
 * leaving it — an edge that loops back through its own node reads as a bug.
 * @param points - The candidate route
 * @param from - Source box
 * @param to - Target box
 * @returns True when neither endpoint box is re-entered
 */
function routeClearsEndpointComponents(
	points: readonly DiagramPoint[],
	from: MeasuredRect,
	to: MeasuredRect,
): boolean {
	const lastSegment = points.length - 2;
	for (let index = 0; index <= lastSegment; index += 1) {
		const start = points[index] as DiagramPoint;
		const end = points[index + 1] as DiagramPoint;
		if (index > 0 && segmentIntersectsRect(start, end, from)) {
			return false;
		}
		if (index < lastSegment && segmentIntersectsRect(start, end, to)) {
			return false;
		}
	}
	return true;
}

/** Everything `routeVia` needs to test a candidate against the rest of the diagram. */
interface RouteContext {
	connection: ArchitectureConnection;
	/** Clear vertical lanes between the column bands, as x coordinates. */
	corridors: readonly number[];
	end: DiagramPoint;
	from: DiagramNode;
	fromSide: ArchitectureSide;
	/** Clear horizontal lanes between the row bands, as y coordinates. */
	gutters: readonly number[];
	nodes: readonly DiagramNode[];
	start: DiagramPoint;
	to: DiagramNode;
	toSide: ArchitectureSide;
}

/**
 * Candidate routes that leave both ends on a short stub and make the whole
 * journey in the clear lanes between boxes: out to a row gutter, across to a
 * column corridor, down it, then back out through the target's row gutter.
 *
 * The stubs are shorter than the narrowest lane, so the only segments that can
 * touch a box are the two that leave the endpoints — which is what the earlier
 * candidates in the ladder already rule on.
 * @param context - The edge, its anchors and sides, and the diagram around it
 * @returns Interior-point candidates, nearest corridor first
 */
function corridorCandidates(context: RouteContext): DiagramPoint[][] {
	const { corridors, end, fromSide, gutters, start, toSide } = context;
	const outward = {
		bottom: [0, 1],
		left: [-1, 0],
		right: [1, 0],
		top: [0, -1],
	} as const satisfies Record<ArchitectureSide, readonly [number, number]>;
	const stubOf = (
		point: DiagramPoint,
		side: ArchitectureSide,
	): DiagramPoint => [
		point[0] + outward[side][0] * LANE_STUB,
		point[1] + outward[side][1] * LANE_STUB,
	];
	const startStub = stubOf(start, fromSide);
	const endStub = stubOf(end, toSide);
	const nearestStart = nearestLane(gutters, startStub[1]);
	const nearestEnd = nearestLane(gutters, endStub[1]);
	if (nearestStart === null || nearestEnd === null) {
		return [];
	}
	const midpoint = (start[0] + end[0]) / 2;
	const byDistanceToMidpoint = [...corridors].sort(
		(left, right) => Math.abs(left - midpoint) - Math.abs(right - midpoint),
	);
	// The nearest gutter to each end first, which is the short way round and the
	// one that used to be the only offer. Every other pairing is appended behind
	// it, so a route that already had a candidate still takes the same one.
	const gutterPairs: (readonly [number, number])[] = [
		[nearestStart, nearestEnd],
		...gutters.flatMap((startGutter) =>
			gutters.map((endGutter) => [startGutter, endGutter] as const),
		),
	];

	return gutterPairs
		.flatMap(([startGutter, endGutter]) =>
			byDistanceToMidpoint.map((lane): DiagramPoint[] => [
				startStub,
				[startStub[0], startGutter],
				[lane, startGutter],
				[lane, endGutter],
				[endStub[0], endGutter],
				endStub,
			]),
		)
		.map((candidate) => [...normalizeRoutePoints([start, ...candidate, end])])
		.filter((points) => points.length >= 2)
		.map((points) => points.slice(1, -1));
}

/**
 * The interior points between an edge's two anchors, honouring an authored
 * `via` or `route` and otherwise choosing the first dogleg that keeps both
 * endpoint sides and clears every other box.
 * @param context - The edge, its anchors and sides, and the diagram around it
 * @returns The interior points, which may be empty for a straight run
 */
function routeVia(context: RouteContext): readonly DiagramPoint[] {
	const { connection, end, start } = context;
	if (connection.via) {
		return connection.via;
	}
	switch (connection.route ?? 'auto') {
		case 'straight':
			return [];
		case 'orthogonal-h': {
			const midX = (start[0] + end[0]) / 2;
			return [
				[midX, start[1]],
				[midX, end[1]],
			];
		}
		case 'orthogonal-v': {
			const midY = (start[1] + end[1]) / 2;
			return [
				[start[0], midY],
				[end[0], midY],
			];
		}
		default:
			return automaticRouteVia(context);
	}
}

/**
 * The automatic router: a direct run when the anchors already line up, then an
 * outside channel for near-parallel ports, then the two midpoint doglegs, each
 * candidate accepted only when it honours both sides and hits nothing.
 * @param context - The edge, its anchors and sides, and the diagram around it
 * @returns The interior points of the best candidate
 */
function automaticRouteVia(context: RouteContext): readonly DiagramPoint[] {
	const { connection, end, from, fromSide, nodes, start, to, toSide } = context;
	const deltaX = Math.abs(start[0] - end[0]);
	const deltaY = Math.abs(start[1] - end[1]);
	// The direct run has to be checked like any other candidate. Left unchecked
	// it fires on every pair of anchors that happens to line up — which is every
	// same-column edge, however many boxes sit between the two rows.
	if (
		(deltaX < 4 || deltaY < 4) &&
		routeHonorsEndpointSides([start, end], fromSide, toSide) &&
		routeClearsComponents(connection, [start, end], nodes)
	) {
		return [];
	}

	const bridge = automaticPortRhythmBridge(
		start,
		end,
		fromSide,
		toSide,
		(points) =>
			routeClearsEndpointComponents(points, from, to) &&
			routeClearsComponents(connection, points, nodes),
	);
	if (bridge) {
		return bridge.slice(1, -1);
	}

	const channel = outsideChannelVia(context, deltaX, deltaY);
	if (channel) {
		return channel;
	}

	const midX = (start[0] + end[0]) / 2;
	const horizontalFirst: DiagramPoint[] = [
		[midX, start[1]],
		[midX, end[1]],
	];
	const midY = (start[1] + end[1]) / 2;
	const verticalFirst: DiagramPoint[] = [
		[start[0], midY],
		[end[0], midY],
	];
	const doglegs = [horizontalFirst, verticalFirst];
	const sideSafe = doglegs.filter((candidate) =>
		routeHonorsEndpointSides([start, ...candidate, end], fromSide, toSide),
	);
	const sideAware = sideAwareBridgeCandidates(start, end, fromSide, toSide);
	const nearParallelPorts =
		isVerticalSide(fromSide) === isVerticalSide(toSide) &&
		(isVerticalSide(fromSide)
			? deltaX < MINIMUM_STUB_PX * 2
			: deltaY < MINIMUM_STUB_PX * 2);
	const ordered = [
		...(nearParallelPorts ? sideAware : sideSafe),
		...(nearParallelPorts ? sideSafe : sideAware),
		...doglegs.filter((candidate) => !sideSafe.includes(candidate)),
	];
	for (const candidate of [...ordered, ...corridorCandidates(context)]) {
		const points = [start, ...candidate, end];
		if (
			routeClearsEndpointComponents(points, from, to) &&
			routeClearsComponents(connection, points, nodes)
		) {
			return candidate;
		}
	}
	return sideSafe[0] ?? sideAware[0] ?? horizontalFirst;
}

/**
 * The first bounded channel just outside both anchors that keeps the endpoint
 * sides and clears every other box.
 *
 * Written once and used for both axes: the vertical case slides a channel along
 * x between two anchors on horizontal box edges, the horizontal case does the
 * mirror. The two read identically apart from which coordinate is fixed, which
 * is what the axis parameter carries.
 * @param context - The edge, its anchors and sides, and the diagram around it
 * @param axis - Which coordinate the channel is placed on
 * @returns The channel's interior points, or null when neither side is clear
 */
function channelCandidate(
	context: RouteContext,
	axis: 'x' | 'y',
): readonly DiagramPoint[] | null {
	const { connection, end, fromSide, nodes, start, toSide } = context;
	const index = axis === 'x' ? 0 : 1;
	const other = axis === 'x' ? 1 : 0;
	for (const channel of [
		Math.max(start[index], end[index]) + MINIMUM_STUB_PX * 2,
		Math.min(start[index], end[index]) - MINIMUM_STUB_PX * 2,
	]) {
		const at = (point: DiagramPoint): DiagramPoint =>
			axis === 'x' ? [channel, point[other]] : [point[other], channel];
		const candidate: DiagramPoint[] = [at(start), at(end)];
		const points = [start, ...candidate, end];
		if (
			routeHonorsEndpointSides(points, fromSide, toSide) &&
			routeClearsComponents(connection, points, nodes)
		) {
			return candidate;
		}
	}
	return null;
}

/**
 * A bounded channel just outside both anchors, for the case where port
 * spreading left two parallel-side anchors nearly aligned and a midpoint route
 * would split the difference into two unreadable stubs.
 * @param context - The edge, its anchors and sides, and the diagram around it
 * @param deltaX - Horizontal distance between the anchors
 * @param deltaY - Vertical distance between the anchors
 * @returns The channel's interior points, or null when no channel is clear
 */
function outsideChannelVia(
	context: RouteContext,
	deltaX: number,
	deltaY: number,
): readonly DiagramPoint[] | null {
	const { end, from, start, to } = context;
	const onHorizontalEdge = (point: DiagramPoint, rect: MeasuredRect) =>
		point[1] === rect.y || point[1] === rect.y + rect.height;
	const onVerticalEdge = (point: DiagramPoint, rect: MeasuredRect) =>
		point[0] === rect.x || point[0] === rect.x + rect.width;

	if (
		onHorizontalEdge(start, from) &&
		onHorizontalEdge(end, to) &&
		deltaX < MINIMUM_STUB_PX * 2
	) {
		const channel = channelCandidate(context, 'x');
		if (channel) {
			return channel;
		}
	}
	if (
		onVerticalEdge(start, from) &&
		onVerticalEdge(end, to) &&
		deltaY < MINIMUM_STUB_PX * 2
	) {
		return channelCandidate(context, 'y');
	}
	return null;
}

/**
 * Candidate routes built from outward stubs on both ends, which keep the
 * endpoint normals a plain midpoint dogleg would break.
 * @param start - Source anchor
 * @param end - Target anchor
 * @param fromSide - Side the route leaves through
 * @param toSide - Side the route arrives through
 * @returns Interior-point candidates, best-first
 */
function sideAwareBridgeCandidates(
	start: DiagramPoint,
	end: DiagramPoint,
	fromSide: ArchitectureSide,
	toSide: ArchitectureSide,
): DiagramPoint[][] {
	const stub = 24;
	const minimumBridge = 16;
	const outward = {
		bottom: [0, 1],
		left: [-1, 0],
		right: [1, 0],
		top: [0, -1],
	} as const satisfies Record<ArchitectureSide, readonly [number, number]>;
	const startStub: DiagramPoint = [
		start[0] + outward[fromSide][0] * stub,
		start[1] + outward[fromSide][1] * stub,
	];
	const endStub: DiagramPoint = [
		end[0] + outward[toSide][0] * stub,
		end[1] + outward[toSide][1] * stub,
	];
	const raw: DiagramPoint[][] = [];

	if (
		isVerticalSide(fromSide) &&
		isVerticalSide(toSide) &&
		Math.abs(start[0] - end[0]) < minimumBridge
	) {
		for (const channelX of [
			Math.max(start[0], end[0]) + minimumBridge,
			Math.min(start[0], end[0]) - minimumBridge,
		]) {
			raw.push([
				startStub,
				[channelX, startStub[1]],
				[channelX, endStub[1]],
				endStub,
			]);
		}
	}
	if (
		!isVerticalSide(fromSide) &&
		!isVerticalSide(toSide) &&
		Math.abs(start[1] - end[1]) < minimumBridge
	) {
		for (const channelY of [
			Math.max(start[1], end[1]) + minimumBridge,
			Math.min(start[1], end[1]) - minimumBridge,
		]) {
			raw.push([
				startStub,
				[startStub[0], channelY],
				[endStub[0], channelY],
				endStub,
			]);
		}
	}

	raw.push(
		[startStub, [endStub[0], startStub[1]], endStub],
		[startStub, [startStub[0], endStub[1]], endStub],
	);

	return raw.flatMap((candidate) => {
		const points = [...normalizeRoutePoints([start, ...candidate, end])];
		if (points.length < 2 || !isUsableBridge(points, fromSide, toSide)) {
			return [];
		}
		return [points.slice(1, -1)];
	});
}

/**
 * True when a stub-built candidate is worth routing through: it turns at both
 * ends rather than doubling back on itself, and it honours both endpoint sides.
 * @param points - The normalized candidate, endpoints included
 * @param fromSide - Side the route must leave through
 * @param toSide - Side the route must arrive through
 * @returns True when the candidate may be used
 */
function isUsableBridge(
	points: readonly DiagramPoint[],
	fromSide: ArchitectureSide,
	toSide: ArchitectureSide,
): boolean {
	const backtracksAtStart = collinearBacktrack(
		points[0] as DiagramPoint,
		points[1] as DiagramPoint,
		(points[2] ?? points[1]) as DiagramPoint,
	);
	const backtracksAtEnd = collinearBacktrack(
		(points.at(-3) ?? points.at(-2)) as DiagramPoint,
		points.at(-2) as DiagramPoint,
		points.at(-1) as DiagramPoint,
	);
	return (
		!backtracksAtStart &&
		!backtracksAtEnd &&
		routeHonorsEndpointSides(points, fromSide, toSide)
	);
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
 * Compiles an Euler document: positions and frames from the organic solver,
 * connections as curves between the boxes it placed.
 * @param ir - The document to lay out
 * @returns The compiled layout
 */
function compileOrganic(ir: ArchitectureIR): DiagramLayout {
	const solution = solveOrganicLayout(ir);
	const problems = [...solution.problems];
	const placedIds = new Set(ir.components.map((component) => component.id));
	for (const boundary of ir.boundaries ?? []) {
		if (!boundary.wraps.some((id) => placedIds.has(id))) {
			problems.push(
				`Boundary "${boundary.label}" wraps no component that exists.`,
			);
		}
	}

	const nodes = ir.components.map((component) =>
		measureAt(
			component,
			solution.positions.get(component.id) ?? [Number.NaN, Number.NaN],
			component.size ?? SOLVED_NODE_SIZE,
		),
	);
	const nodeById = new Map(nodes.map((node) => [node.id, node]));
	const routable = routableConnections(ir, nodeById, problems);

	const corridors = clearLanes(nodes, 'x');
	const gutters = clearLanes(nodes, 'y');
	const ports = automaticPortSpread(routable, nodeById, (connection) =>
		sidesFor(connection, nodeById),
	);
	const edges = routable.map((connection) =>
		navigatedEdge(connection, {
			corridors,
			from: nodeById.get(connection.from) as DiagramNode,
			gutters,
			nodes,
			spread: ports.get(connection.id) ?? null,
			to: nodeById.get(connection.to) as DiagramNode,
		}),
	);

	return {
		edges,
		frames: solution.frames,
		nodes,
		problems,
		viewBox: resolveViewBox(nodes, solution.frames, ir.meta.viewBox),
	};
}

/**
 * The sides an edge leaves and arrives through: whatever it names, and otherwise
 * whichever sides face each other.
 * @param connection - The edge being routed
 * @param nodeById - Measured components, keyed by id; unused when both are passed
 * @param source - Source box, when the caller already holds it
 * @param target - Target box, when the caller already holds it
 * @returns The two sides
 */
function sidesFor(
	connection: ArchitectureConnection,
	nodeById?: ReadonlyMap<string, DiagramNode>,
	source?: DiagramNode,
	target?: DiagramNode,
): { fromSide: ArchitectureSide; toSide: ArchitectureSide } {
	const from = source ?? (nodeById?.get(connection.from) as DiagramNode);
	const to = target ?? (nodeById?.get(connection.to) as DiagramNode);
	return {
		fromSide: chosenSide(connection.fromSide, defaultFromSide(from, to)),
		toSide: chosenSide(connection.toSide, defaultToSide(from, to)),
	};
}

/**
 * An edge routed through the clear lanes between the boxes.
 *
 * An arrow crossing a box it has nothing to do with reads as a connection to
 * that box, so every edge navigates rather than taking the direct line. This is
 * the same router the grid uses, and it works here for the same reason: the
 * packer lays a region's nodes out in rows, which leaves the lanes it turns into.
 * @param connection - The edge being routed
 * @param context - The two boxes, the diagram around them, and its clear lanes
 * @returns The routed edge, with its corners rounded
 */
function navigatedEdge(
	connection: ArchitectureConnection,
	context: {
		corridors: readonly number[];
		from: DiagramNode;
		gutters: readonly number[];
		nodes: readonly DiagramNode[];
		/** Fanned-out anchors when several edges leave one side of a box. */
		spread: { from?: DiagramPoint; to?: DiagramPoint } | null;
		to: DiagramNode;
	},
): DiagramEdge {
	const { from, spread, to } = context;
	const { fromSide, toSide } = sidesFor(connection, undefined, from, to);
	const start = spread?.from ?? anchor(from, fromSide);
	const end = spread?.to ?? anchor(to, toSide);
	const points = [
		start,
		...routeVia({ ...context, connection, end, fromSide, start, toSide }),
		end,
	];
	return {
		connection,
		d: roundedPath(points, LAYOUT.cornerRadius),
		id: connection.id,
		labelAt: connection.label ? labelPoint(connection, points) : null,
		points,
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

	const routable = routableConnections(ir, nodeById, problems);

	const sideFor = (connection: ArchitectureConnection) => {
		const from = nodeById.get(connection.from) as DiagramNode;
		const to = nodeById.get(connection.to) as DiagramNode;
		return {
			fromSide: chosenSide(connection.fromSide, defaultFromSide(from, to)),
			toSide: chosenSide(connection.toSide, defaultToSide(from, to)),
		};
	};
	const ports = automaticPortSpread(routable, nodeById, sideFor);
	const corridors = clearLanes(nodes, 'x');
	const gutters = clearLanes(nodes, 'y');

	const edges = routable.map((connection): DiagramEdge => {
		const from = nodeById.get(connection.from) as DiagramNode;
		const to = nodeById.get(connection.to) as DiagramNode;
		const { fromSide, toSide } = sideFor(connection);
		const spread = ports.get(connection.id);
		const start = spread?.from ?? anchor(from, fromSide);
		const end = spread?.to ?? anchor(to, toSide);
		const points = [
			start,
			...routeVia({
				connection,
				corridors,
				end,
				gutters,
				from,
				fromSide,
				nodes,
				start,
				to,
				toSide,
			}),
			end,
		];
		return {
			connection,
			d: roundedPath(points, LAYOUT.cornerRadius),
			id: connection.id,
			labelAt: connection.label ? labelPoint(connection, points) : null,
			points,
		};
	});

	return {
		edges,
		frames,
		nodes,
		problems,
		viewBox: resolveViewBox(nodes, frames, ir.meta.viewBox),
	};
}
