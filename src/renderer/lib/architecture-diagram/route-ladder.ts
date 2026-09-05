/**
 * The candidate ladder an automatically routed edge is drawn from.
 *
 * Routing here is generate-and-test rather than search: a fixed sequence of
 * shapes is offered — the direct run, a port-rhythm bridge, an outside channel,
 * the two midpoint doglegs, the side-aware stubs, and finally the clear lanes
 * between the boxes — and the first that honours both endpoint sides and hits
 * nothing else wins. There is no cost function and no backtracking, so the same
 * diagram always routes to the same pixels.
 *
 * Held apart from `compile.ts` because the ladder is closed over a
 * {@link RouteContext} and gives back interior points: it reads the diagram but
 * changes nothing in it, and neither mode compiler needs to know how many rungs
 * there are. `compile.ts` imports {@link routeVia} and {@link selfLoopPoints}
 * and nothing else.
 *
 * The order of the rungs is load-bearing. The cheap shapes come first and the
 * lane sweep last, and the sweep is a generator so an edge that a dogleg
 * already answers never pays to build it.
 */
import type {
	ArchitectureConnection,
	ArchitectureSide,
	DiagramPoint,
} from '@/shared/architecture-diagram';

import { nearestLane } from './lanes';
import type { DiagramNode } from './layout-types';
import {
	automaticPortRhythmBridge,
	collinearBacktrack,
	isVerticalSide,
	type MeasuredRect,
	normalizeRoutePoints,
	routeHonorsEndpointSides,
	segmentIntersectsRect,
} from './routing';

/** Shortest stub the automatic router will fall back to when doglegging. */
const MINIMUM_STUB_PX = 8;

/** How far a lane route leaves its endpoint before turning into the lane. */
const LANE_STUB = 12;

/** How far outside its own box a self-loop's lobe stands. */
const SELF_LOOP_PX = 22;

/**
 * Gutters tried per end in the lane sweep.
 *
 * The sweep used to cross every gutter with every other, which is quadratic in
 * the row count: a 60-row grid built 3,722 pairings per edge and then threw all
 * of them away, because a dogleg had already answered every edge. A route that
 * has to reach a gutter reaches a near one; a far one doubles back.
 */
const NEAREST_GUTTERS = 3;

/** Unit vector pointing out of a box through each side. */
const OUTWARD = {
	bottom: [0, 1],
	left: [-1, 0],
	right: [1, 0],
	top: [0, -1],
} as const satisfies Record<ArchitectureSide, readonly [number, number]>;

/** Everything {@link routeVia} needs to test a candidate against the rest of the diagram. */
export interface RouteContext {
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
 * A point one stub-length outside a box through the given side.
 * @param point - The anchor on the box border
 * @param side - Side the stub leaves through
 * @param length - How far out to stand
 * @returns The stub's far end
 */
function stubOutward(
	point: DiagramPoint,
	side: ArchitectureSide,
	length: number,
): DiagramPoint {
	return [
		point[0] + OUTWARD[side][0] * length,
		point[1] + OUTWARD[side][1] * length,
	];
}

/**
 * The path an edge from a component to itself takes: out of its right side,
 * around the top-right corner, and back in through its top.
 *
 * A loop needs two different sides, and the inferred pair for two boxes at the
 * same centre is top-and-bottom — a straight line down through the box's own
 * middle. Any authored sides are ignored for the same reason: honouring one of
 * a matching pair while overriding the other reads as arbitrary.
 * @param node - The box the edge both leaves and returns to
 * @returns The whole route, endpoints included
 */
export function selfLoopPoints(node: MeasuredRect): readonly DiagramPoint[] {
	const right = node.x + node.width;
	const lobeX = right + SELF_LOOP_PX;
	const lobeY = node.y - SELF_LOOP_PX;
	return [
		[right, node.cy],
		[lobeX, node.cy],
		[lobeX, lobeY],
		[node.cx, lobeY],
		[node.cx, node.y],
	];
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

/**
 * True when a candidate can be drawn: it honours both endpoint sides and
 * crosses neither its own boxes nor anybody else's.
 * @param candidate - Interior points to test
 * @param context - The edge, its anchors and sides, and the diagram around it
 * @returns True when the candidate may be used
 */
function isDrawable(
	candidate: readonly DiagramPoint[],
	context: RouteContext,
): boolean {
	const { connection, end, from, nodes, start, to } = context;
	const points = [start, ...candidate, end];
	return (
		routeClearsEndpointComponents(points, from, to) &&
		routeClearsComponents(connection, points, nodes)
	);
}

/**
 * The first candidate in a sequence that can be drawn, pulling from the
 * sequence only as far as it has to — which is what keeps the lane sweep from
 * being built for an edge a dogleg already answers.
 * @param candidates - Candidates in preference order
 * @param context - The edge, its anchors and sides, and the diagram around it
 * @returns The winning interior points, or null when none survive
 */
function firstDrawable(
	candidates: Iterable<readonly DiagramPoint[]>,
	context: RouteContext,
): readonly DiagramPoint[] | null {
	for (const candidate of candidates) {
		if (isDrawable(candidate, context)) {
			return candidate;
		}
	}
	return null;
}

/**
 * The gutters worth turning into from one end, nearest first.
 * @param gutters - Every clear horizontal lane
 * @param near - Coordinate the route leaves from
 * @returns At most {@link NEAREST_GUTTERS} gutters, nearest first
 */
function nearestGutters(
	gutters: readonly number[],
	near: number,
): readonly number[] {
	return [...gutters]
		.sort((left, right) => Math.abs(left - near) - Math.abs(right - near))
		.slice(0, NEAREST_GUTTERS);
}

/**
 * Candidate routes that leave both ends on a short stub and make the whole
 * journey in the clear lanes between boxes: out to a row gutter, across to a
 * column corridor, down it, then back out through the target's row gutter.
 *
 * The stubs are shorter than the narrowest lane, so the only segments that can
 * touch a box are the two that leave the endpoints — which is what the earlier
 * candidates in the ladder already rule on.
 *
 * Yielded one at a time: this is the last rung, and on a grid of any size most
 * edges never reach it.
 * @param context - The edge, its anchors and sides, and the diagram around it
 * @yields Interior-point candidates, nearest corridor first
 */
function* corridorCandidates(
	context: RouteContext,
): Generator<readonly DiagramPoint[]> {
	const { corridors, end, fromSide, gutters, start, toSide } = context;
	const startStub = stubOutward(start, fromSide, LANE_STUB);
	const endStub = stubOutward(end, toSide, LANE_STUB);
	const nearestStart = nearestLane(gutters, startStub[1]);
	const nearestEnd = nearestLane(gutters, endStub[1]);
	if (nearestStart === null || nearestEnd === null) {
		return;
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
		...nearestGutters(gutters, startStub[1]).flatMap((startGutter) =>
			nearestGutters(gutters, endStub[1]).map(
				(endGutter) => [startGutter, endGutter] as const,
			),
		),
	];

	for (const [startGutter, endGutter] of gutterPairs) {
		for (const lane of byDistanceToMidpoint) {
			const points = [
				...normalizeRoutePoints([
					start,
					startStub,
					[startStub[0], startGutter],
					[lane, startGutter],
					[lane, endGutter],
					[endStub[0], endGutter],
					endStub,
					end,
				]),
			];
			if (points.length >= 2) {
				yield points.slice(1, -1);
			}
		}
	}
}

/**
 * The interior points between an edge's two anchors, honouring an authored
 * `via` or `route` and otherwise choosing the first dogleg that keeps both
 * endpoint sides and clears every other box.
 * @param context - The edge, its anchors and sides, and the diagram around it
 * @returns The interior points, which may be empty for a straight run
 */
export function routeVia(context: RouteContext): readonly DiagramPoint[] {
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
	return (
		firstDrawable(ordered, context) ??
		firstDrawable(corridorCandidates(context), context) ??
		sideSafe[0] ??
		sideAware[0] ??
		horizontalFirst
	);
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
	const startStub = stubOutward(start, fromSide, stub);
	const endStub = stubOutward(end, toSide, stub);
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
