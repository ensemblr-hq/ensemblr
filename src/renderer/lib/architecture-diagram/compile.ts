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

import {
	gridLayout,
	type ResolvedGrid,
	resolveComponentPos,
	validateGridPlacement,
} from './grid';
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

/** Fixed box and frame metrics, matching archify's architecture renderer. */
const LAYOUT = {
	boundaryExtraBottom: 20,
	boundaryLabelBaseline: 18,
	boundaryLabelClearance: 4,
	boundaryLabelHeight: 16,
	boundaryLabelInset: 4,
	boundaryPad: 30,
	cornerRadius: 8,
	defaultH: 60,
	defaultW: 120,
	margin: 40,
} as const;

/** Shortest stub the automatic router will fall back to when doglegging. */
const MINIMUM_STUB_PX = 8;

/** A positioned node, ready to draw. */
export interface DiagramNode extends MeasuredRect {
	component: ArchitectureComponent;
}

/** A routed edge, ready to draw. */
export interface DiagramEdge {
	connection: ArchitectureConnection;
	/** SVG `d` attribute with the corners rounded. */
	d: string;
	id: string;
	/** Where the label sits, or null when the edge carries none. */
	labelAt: DiagramPoint | null;
	points: readonly DiagramPoint[];
}

/** A boundary frame with its title band. */
export interface DiagramFrame {
	boundary: ArchitectureBoundary;
	height: number;
	/** Composite identity, `kind:label` — what the delta comparator matches on. */
	id: string;
	title: { height: number; width: number; x: number; y: number };
	width: number;
	x: number;
	y: number;
}

/** Everything the SVG surface needs, plus whatever the IR got wrong. */
export interface DiagramLayout {
	edges: readonly DiagramEdge[];
	frames: readonly DiagramFrame[];
	nodes: readonly DiagramNode[];
	/** Placement and reference faults, surfaced rather than silently drawn. */
	problems: readonly string[];
	viewBox: DiagramSize;
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
	const [x, y] = resolveComponentPos(component, grid);
	const [width, height] = component.size ?? [LAYOUT.defaultW, LAYOUT.defaultH];
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
	const pad = boundary.pad ?? LAYOUT.boundaryPad;
	const topPad = Math.max(
		pad,
		LAYOUT.boundaryLabelBaseline + LAYOUT.boundaryLabelClearance,
	);
	const width = maxX - minX + pad * 2;
	return {
		boundary,
		height: maxY - minY + topPad + LAYOUT.boundaryExtraBottom,
		id: `${boundary.kind}:${boundary.label}`,
		title: {
			height: LAYOUT.boundaryLabelHeight,
			width: Math.max(
				0,
				Math.min(
					width - LAYOUT.boundaryLabelInset * 2,
					boundary.label.length * 5 + 10,
				),
			),
			x: minX - pad + LAYOUT.boundaryLabelInset,
			y: minY - LAYOUT.boundaryLabelClearance - LAYOUT.boundaryLabelHeight,
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
	end: DiagramPoint;
	from: DiagramNode;
	fromSide: ArchitectureSide;
	nodes: readonly DiagramNode[];
	start: DiagramPoint;
	to: DiagramNode;
	toSide: ArchitectureSide;
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
	if (
		(deltaX < 4 || deltaY < 4) &&
		routeHonorsEndpointSides([start, end], fromSide, toSide)
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
	for (const candidate of ordered) {
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
 * Compiles a document into drawable geometry.
 * @param ir - The architecture IR to lay out
 * @returns The nodes, edges, frames, viewBox, and any faults found on the way
 */
export function compileArchitectureLayout(ir: ArchitectureIR): DiagramLayout {
	const grid = gridLayout(ir.layout);
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

	const routable = (ir.connections ?? []).filter((connection) => {
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

	const sideFor = (connection: ArchitectureConnection) => {
		const from = nodeById.get(connection.from) as DiagramNode;
		const to = nodeById.get(connection.to) as DiagramNode;
		return {
			fromSide: chosenSide(connection.fromSide, defaultFromSide(from, to)),
			toSide: chosenSide(connection.toSide, defaultToSide(from, to)),
		};
	};
	const ports = automaticPortSpread(routable, nodeById, sideFor);

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
				end,
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
