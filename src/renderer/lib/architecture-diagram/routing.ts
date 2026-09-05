/**
 * Orthogonal edge routing for the architecture diagram.
 *
 * Ported from the routing subset of archify's `renderers/shared/geometry.mjs`.
 * Copyright (c) archify contributors. Licensed under the MIT License.
 *
 * Roughly a third of that module: the anchors, the side inference, the port
 * spreading, the two path serializers, and the label anchor. Its other ~25
 * exports are route-quality *diagnostics* — they report on a route rather than
 * produce one — and have no consumer here.
 *
 * Every function is pure and takes measured rects in, so the whole compiler
 * runs under Vitest's `node` environment with no DOM.
 */
import type {
	ArchitectureConnection,
	ArchitectureSide,
	DiagramPoint,
} from '@/shared/architecture-diagram';

/** A measured, positioned box: the rect plus the centre the anchors need. */
export interface MeasuredRect {
	cx: number;
	cy: number;
	height: number;
	id: string;
	width: number;
	x: number;
	y: number;
}

/** Tolerance every geometric comparison here uses. */
const EPSILON = 0.0001;

/** How far a route's first and last segments run straight out of their port. */
const ENDPOINT_STUB_PX = 24;

/** Shortest interior segment a route may contain before it reads as noise. */
const INTERIOR_SEGMENT_PX = 16;

/** Shortest segment of any kind a route may contain. */
const MICRO_SEGMENT_PX = 8;

/** Unit vector pointing out of a box through each side. */
const OUTWARD_VECTOR: Record<ArchitectureSide, DiagramPoint> = {
	bottom: [0, 1],
	left: [-1, 0],
	right: [1, 0],
	top: [0, -1],
};

/**
 * A side is a direction contract, not just a point on a border: an edge leaving
 * `right` must run rightward and perpendicular. This table encodes that, per
 * side, for both ends.
 */
const ENDPOINT_SIDE_RULES: Record<
	ArchitectureSide,
	{ axis: 'horizontal' | 'vertical'; sourceSign: number; targetSign: number }
> = {
	bottom: { axis: 'vertical', sourceSign: 1, targetSign: -1 },
	left: { axis: 'horizontal', sourceSign: -1, targetSign: 1 },
	right: { axis: 'horizontal', sourceSign: 1, targetSign: -1 },
	top: { axis: 'vertical', sourceSign: -1, targetSign: 1 },
};

/**
 * The point on a box's border an edge attaches to.
 * @param rect - The measured box
 * @param side - Which side to attach on
 * @returns The anchor point
 */
export function anchor(
	rect: MeasuredRect,
	side: ArchitectureSide,
): DiagramPoint {
	switch (side) {
		case 'left':
			return [rect.x, rect.cy];
		case 'top':
			return [rect.cx, rect.y];
		case 'bottom':
			return [rect.cx, rect.y + rect.height];
		default:
			return [rect.x + rect.width, rect.cy];
	}
}

/**
 * Cross product of `ab` and `ac`, whose sign says which way `c` turns.
 * @param a - First point
 * @param b - Second point
 * @param c - Third point
 * @returns Twice the signed area of the triangle
 */
function crossProduct(
	a: DiagramPoint,
	b: DiagramPoint,
	c: DiagramPoint,
): number {
	return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/**
 * True when `c` continues straight on from `a` through `b` — collinear and
 * forward, so `b` is a redundant vertex.
 * @param a - Point before the candidate vertex
 * @param b - The candidate vertex
 * @param c - Point after it
 * @returns True when `b` can be dropped
 */
function collinearForward(
	a: DiagramPoint,
	b: DiagramPoint,
	c: DiagramPoint,
): boolean {
	if (Math.abs(crossProduct(a, b, c)) > EPSILON) {
		return false;
	}
	return (
		(b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) >= -EPSILON
	);
}

/**
 * True when the turn at `b` doubles back on the segment that reached it.
 * @param a - Point before the vertex
 * @param b - The vertex
 * @param c - Point after it
 * @returns True when the route reverses through `b`
 */
export function collinearBacktrack(
	a: DiagramPoint,
	b: DiagramPoint,
	c: DiagramPoint,
): boolean {
	const first: DiagramPoint = [b[0] - a[0], b[1] - a[1]];
	const second: DiagramPoint = [c[0] - b[0], c[1] - b[1]];
	const cross = first[0] * second[1] - first[1] * second[0];
	const dot = first[0] * second[0] + first[1] * second[1];
	return Math.abs(cross) <= EPSILON && dot < -EPSILON;
}

/**
 * Drops non-finite points, coincident duplicates, and collinear vertices, so a
 * route carries only the corners it actually turns at.
 * @param points - Candidate route points
 * @returns The same route with nothing redundant in it
 */
export function normalizeRoutePoints(
	points: readonly DiagramPoint[],
): readonly DiagramPoint[] {
	const finite = points.filter(
		(point) => Number.isFinite(point[0]) && Number.isFinite(point[1]),
	);
	const deduped: DiagramPoint[] = [];
	for (const point of finite) {
		const previous = deduped.at(-1);
		if (
			!previous ||
			Math.abs(point[0] - previous[0]) > EPSILON ||
			Math.abs(point[1] - previous[1]) > EPSILON
		) {
			deduped.push(point);
		}
	}
	const normalized: DiagramPoint[] = [];
	for (const point of deduped) {
		while (
			normalized.length >= 2 &&
			collinearForward(
				normalized.at(-2) as DiagramPoint,
				normalized.at(-1) as DiagramPoint,
				point,
			)
		) {
			normalized.pop();
		}
		normalized.push(point);
	}
	return normalized;
}

/**
 * True when the route's first and last segments leave and enter their declared
 * sides perpendicularly and in the right direction.
 * @param points - The route
 * @param fromSide - Side the route must leave through
 * @param toSide - Side the route must arrive through
 * @returns True when both endpoint segments honour their side
 */
export function routeHonorsEndpointSides(
	points: readonly DiagramPoint[],
	fromSide: ArchitectureSide,
	toSide: ArchitectureSide,
): boolean {
	return (
		endpointHonorsSide(points, 'source', fromSide) &&
		endpointHonorsSide(points, 'target', toSide)
	);
}

/**
 * True when one end's segment runs perpendicular to its side and away from (or
 * into) the box as that end requires.
 * @param points - The route
 * @param endpoint - Which end to check
 * @param side - The side that end declares
 * @returns True when the segment honours the side
 */
function endpointHonorsSide(
	points: readonly DiagramPoint[],
	endpoint: 'source' | 'target',
	side: ArchitectureSide,
): boolean {
	const rule = ENDPOINT_SIDE_RULES[side];
	const normalized = normalizeRoutePoints(points);
	if (normalized.length < 2) {
		return true;
	}
	const segmentIndex = endpoint === 'source' ? 0 : normalized.length - 2;
	const start = normalized[segmentIndex] as DiagramPoint;
	const end = normalized[segmentIndex + 1] as DiagramPoint;
	const dx = end[0] - start[0];
	const dy = end[1] - start[1];
	const along = rule.axis === 'horizontal' ? dx : dy;
	const across = rule.axis === 'horizontal' ? dy : dx;
	const expectedSign =
		endpoint === 'source' ? rule.sourceSign : rule.targetSign;
	return Math.abs(across) <= EPSILON && along * expectedSign > EPSILON;
}

/**
 * True when every segment clears the rhythm floors — no micro segment anywhere,
 * no short interior segment. A route that fails reads as visual noise.
 * @param points - The route
 * @returns True when every segment is long enough for its position
 */
function routeHasCleanRhythm(points: readonly DiagramPoint[]): boolean {
	const normalized = normalizeRoutePoints(points);
	if (normalized.length < 2) {
		return true;
	}
	const segmentCount = normalized.length - 1;
	for (let index = 0; index < segmentCount; index += 1) {
		const start = normalized[index] as DiagramPoint;
		const end = normalized[index + 1] as DiagramPoint;
		const length = Math.abs(end[0] - start[0]) + Math.abs(end[1] - start[1]);
		if (length <= EPSILON) {
			continue;
		}
		if (length < MICRO_SEGMENT_PX - EPSILON) {
			return false;
		}
		const isInterior = index > 0 && index < segmentCount - 1;
		if (isInterior && length < INTERIOR_SEGMENT_PX - EPSILON) {
			return false;
		}
	}
	return true;
}

/**
 * Full outside-channel route for endpoints that port spreading left only a few
 * pixels apart, where a midpoint dogleg would violate the rhythm floors.
 * @param start - Source anchor
 * @param end - Target anchor
 * @param fromSide - Side the route leaves through
 * @param toSide - Side the route arrives through
 * @param accept - Extra predicate the candidate must satisfy, e.g. obstacle clearance
 * @returns The bridging route, or null when a normal automatic route will do
 */
export function automaticPortRhythmBridge(
	start: DiagramPoint,
	end: DiagramPoint,
	fromSide: ArchitectureSide,
	toSide: ArchitectureSide,
	accept?: (points: readonly DiagramPoint[]) => boolean,
): readonly DiagramPoint[] | null {
	if (
		!Number.isFinite(start[0]) ||
		!Number.isFinite(start[1]) ||
		!Number.isFinite(end[0]) ||
		!Number.isFinite(end[1])
	) {
		return null;
	}
	const fromVector = OUTWARD_VECTOR[fromSide];
	const toVector = OUTWARD_VECTOR[toSide];
	const startStub: DiagramPoint = [
		start[0] + fromVector[0] * ENDPOINT_STUB_PX,
		start[1] + fromVector[1] * ENDPOINT_STUB_PX,
	];
	const endStub: DiagramPoint = [
		end[0] + toVector[0] * ENDPOINT_STUB_PX,
		end[1] + toVector[1] * ENDPOINT_STUB_PX,
	];
	const candidates: DiagramPoint[][] = [];

	if (
		isVerticalSide(fromSide) &&
		isVerticalSide(toSide) &&
		Math.abs(start[0] - end[0]) < INTERIOR_SEGMENT_PX
	) {
		for (const channelX of [
			Math.max(start[0], end[0]) + INTERIOR_SEGMENT_PX,
			Math.min(start[0], end[0]) - INTERIOR_SEGMENT_PX,
		]) {
			candidates.push([
				start,
				startStub,
				[channelX, startStub[1]],
				[channelX, endStub[1]],
				endStub,
				end,
			]);
		}
	}
	if (
		!isVerticalSide(fromSide) &&
		!isVerticalSide(toSide) &&
		Math.abs(start[1] - end[1]) < INTERIOR_SEGMENT_PX
	) {
		for (const channelY of [
			Math.max(start[1], end[1]) + INTERIOR_SEGMENT_PX,
			Math.min(start[1], end[1]) - INTERIOR_SEGMENT_PX,
		]) {
			candidates.push([
				start,
				startStub,
				[startStub[0], channelY],
				[endStub[0], channelY],
				endStub,
				end,
			]);
		}
	}

	return (
		candidates
			.map((points) => normalizeRoutePoints(points))
			.find(
				(points) =>
					routeHonorsEndpointSides(points, fromSide, toSide) &&
					routeHasCleanRhythm(points) &&
					(!accept || accept(points)),
			) ?? null
	);
}

/**
 * True for the two sides an edge leaves vertically through.
 * @param side - The side to test
 * @returns True for `top` and `bottom`
 */
export function isVerticalSide(side: ArchitectureSide): boolean {
	return side === 'top' || side === 'bottom';
}

/** Gutter kept clear at each end of a side when ports are spread along it. */
const PORT_GUTTER_PX = 16;

/** Widest gap the spread will put between two ports on one side. */
const PORT_MAX_SPACING_PX = 14;

/** One endpoint of one connection, grouped by the box side it attaches to. */
interface PortCandidate {
	connection: ArchitectureConnection;
	counterpart: MeasuredRect;
	endpoint: 'from' | 'to';
	rect: MeasuredRect;
	side: ArchitectureSide;
}

/**
 * True when a connection's anchors are the router's to choose. Authored
 * geometry — an explicit route, `via` points, a placed label — means the author
 * already decided where the edge attaches, and spreading would move it. A
 * self-loop is drawn as a fixed lobe rather than anchored side to side, so it
 * neither takes a port slot nor gives one up.
 * @param connection - The connection to test
 * @returns True when the router owns both anchors
 */
function hasAutomaticPorts(connection: ArchitectureConnection): boolean {
	if (connection.route && connection.route !== 'auto') {
		return false;
	}
	if (connection.from === connection.to) {
		return false;
	}
	return !(connection.via || connection.labelAt);
}

/**
 * Buckets every automatic endpoint by the box side it attaches to, which is the
 * unit the spread is computed over.
 * @param connections - Every connection in the document
 * @param boxes - Measured components, keyed by id
 * @param sideFor - Resolves each connection's sides
 * @returns Candidates keyed by `<box id> <side>`
 */
function groupPortCandidates(
	connections: readonly ArchitectureConnection[],
	boxes: ReadonlyMap<string, MeasuredRect>,
	sideFor: (connection: ArchitectureConnection) => {
		fromSide: ArchitectureSide;
		toSide: ArchitectureSide;
	},
): ReadonlyMap<string, readonly PortCandidate[]> {
	const groups = new Map<string, PortCandidate[]>();
	for (const connection of connections) {
		const from = boxes.get(connection.from);
		const to = boxes.get(connection.to);
		if (!hasAutomaticPorts(connection) || !from || !to) {
			continue;
		}
		const { fromSide, toSide } = sideFor(connection);
		const endpoints: PortCandidate[] = [
			{
				connection,
				counterpart: to,
				endpoint: 'from',
				rect: from,
				side: fromSide,
			},
			{ connection, counterpart: from, endpoint: 'to', rect: to, side: toSide },
		];
		for (const entry of endpoints) {
			const key = `${entry.rect.id} ${entry.side}`;
			groups.set(key, [...(groups.get(key) ?? []), entry]);
		}
	}
	return groups;
}

/**
 * Orders the edges sharing one side by where their far end sits, so the fan
 * does not cross itself. Ties break on connection id, which keeps the order
 * stable across rebuilds rather than following list order.
 * @param items - Candidates on one side
 * @param spreadsVertically - Whether the ports slide along the box's height
 * @returns The same candidates, in the order they should be laid out
 */
function orderPortsAlongSide(
	items: readonly PortCandidate[],
	spreadsVertically: boolean,
): readonly PortCandidate[] {
	return [...items].sort((a, b) => {
		const aCoordinate = spreadsVertically ? a.counterpart.cy : a.counterpart.cx;
		const bCoordinate = spreadsVertically ? b.counterpart.cy : b.counterpart.cx;
		if (aCoordinate !== bCoordinate) {
			return aCoordinate - bCoordinate;
		}
		return a.connection.id < b.connection.id ? -1 : 1;
	});
}

/**
 * Fans out anchors that would otherwise stack on one side's midpoint, so a
 * node with several edges on the same side shows them as distinct ports.
 * Authored geometry is left alone — see {@link hasAutomaticPorts}.
 * @param connections - Every connection in the document
 * @param boxes - Measured components, keyed by id
 * @param sideFor - Resolves each connection's sides
 * @returns Per-connection replacement anchors, for the connections that got one
 */
export function automaticPortSpread(
	connections: readonly ArchitectureConnection[],
	boxes: ReadonlyMap<string, MeasuredRect>,
	sideFor: (connection: ArchitectureConnection) => {
		fromSide: ArchitectureSide;
		toSide: ArchitectureSide;
	},
): ReadonlyMap<string, { from?: DiagramPoint; to?: DiagramPoint }> {
	const spread = new Map<string, { from?: DiagramPoint; to?: DiagramPoint }>();
	for (const items of groupPortCandidates(
		connections,
		boxes,
		sideFor,
	).values()) {
		const first = items[0];
		if (items.length < 2 || !first) {
			continue;
		}
		const spreadsVertically = !isVerticalSide(first.side);
		const extent = spreadsVertically ? first.rect.height : first.rect.width;
		const usable = Math.max(0, extent - PORT_GUTTER_PX * 2);
		const spacing = Math.min(PORT_MAX_SPACING_PX, usable / (items.length - 1));
		if (!(spacing > 0)) {
			continue;
		}
		const ordered = orderPortsAlongSide(items, spreadsVertically);
		for (const [index, item] of ordered.entries()) {
			const offset = (index - (ordered.length - 1) / 2) * spacing;
			const [x, y] = anchor(item.rect, item.side);
			const point: DiagramPoint = spreadsVertically
				? [x, y + offset]
				: [x + offset, y];
			spread.set(item.connection.id, {
				...spread.get(item.connection.id),
				[item.endpoint]: point,
			});
		}
	}
	return spread;
}

/**
 * The side an edge leaves its source through when it names none, taken from the
 * two boxes' relative position.
 * @param from - Source box
 * @param to - Target box
 * @returns The inferred source side
 */
export function defaultFromSide(
	from: MeasuredRect,
	to: MeasuredRect,
): ArchitectureSide {
	if (to.cx < from.cx) {
		return 'left';
	}
	if (to.cx > from.cx) {
		return 'right';
	}
	return to.cy > from.cy ? 'bottom' : 'top';
}

/**
 * The side an edge arrives at its target through when it names none — the
 * mirror of {@link defaultFromSide}.
 * @param from - Source box
 * @param to - Target box
 * @returns The inferred target side
 */
export function defaultToSide(
	from: MeasuredRect,
	to: MeasuredRect,
): ArchitectureSide {
	if (to.cx < from.cx) {
		return 'right';
	}
	if (to.cx > from.cx) {
		return 'left';
	}
	return to.cy > from.cy ? 'top' : 'bottom';
}

/**
 * The authored side when there is one, else the inferred fallback.
 * @param side - The side the connection names, if any
 * @param fallback - The inferred side
 * @returns The side to route through
 */
export function chosenSide(
	side: ArchitectureSide | undefined,
	fallback: ArchitectureSide,
): ArchitectureSide {
	return side ?? fallback;
}

/**
 * Serializes a route as a straight-cornered SVG path.
 * @param points - The route
 * @returns An SVG `d` attribute
 */
export function polylinePath(points: readonly DiagramPoint[]): string {
	return points
		.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`)
		.join(' ');
}

/**
 * Serializes a route as an SVG path with its corners rounded, clamping each
 * corner's radius to half of the shorter adjacent segment so a tight turn does
 * not overshoot.
 * @param points - The route
 * @param radius - Corner radius to aim for
 * @returns An SVG `d` attribute
 */
export function roundedPath(
	points: readonly DiagramPoint[],
	radius: number,
): string {
	if (points.length < 3 || radius <= 0) {
		return polylinePath(points);
	}
	const first = points[0] as DiagramPoint;
	const commands = [`M ${first[0]} ${first[1]}`];
	for (let index = 1; index < points.length - 1; index += 1) {
		const [px, py] = points[index - 1] as DiagramPoint;
		const [cx, cy] = points[index] as DiagramPoint;
		const [nx, ny] = points[index + 1] as DiagramPoint;
		const previousLength = Math.hypot(cx - px, cy - py);
		const nextLength = Math.hypot(nx - cx, ny - cy);
		const cornerRadius = Math.min(radius, previousLength / 2, nextLength / 2);
		if (cornerRadius < 1) {
			commands.push(`L ${cx} ${cy}`);
			continue;
		}
		const beforeX = cx - ((cx - px) / previousLength) * cornerRadius;
		const beforeY = cy - ((cy - py) / previousLength) * cornerRadius;
		const afterX = cx + ((nx - cx) / nextLength) * cornerRadius;
		const afterY = cy + ((ny - cy) / nextLength) * cornerRadius;
		commands.push(`L ${beforeX} ${beforeY}`);
		commands.push(`Q ${cx} ${cy} ${afterX} ${afterY}`);
	}
	const last = points.at(-1) as DiagramPoint;
	commands.push(`L ${last[0]} ${last[1]}`);
	return commands.join(' ');
}

/**
 * Where an edge's label sits: its authored anchor, else the midpoint of the
 * chosen segment lifted clear of the stroke.
 * @param connection - The connection, for its label offsets
 * @param points - Its routed points
 * @returns The label anchor
 */
export function labelPoint(
	connection: ArchitectureConnection,
	points: readonly DiagramPoint[],
): DiagramPoint {
	if (connection.labelAt) {
		return connection.labelAt;
	}
	const labelDx = connection.labelDx ?? 0;
	const labelDy = connection.labelDy ?? 0;
	if (points.length === 2) {
		const [start, end] = points as [DiagramPoint, DiagramPoint];
		return [(start[0] + end[0]) / 2 + labelDx, start[1] - 10 + labelDy];
	}
	const segmentIndex = Math.min(
		points.length - 2,
		Math.max(0, connection.labelSegment ?? 1),
	);
	const a = points[segmentIndex] as DiagramPoint;
	const b = points[segmentIndex + 1] as DiagramPoint;
	return [(a[0] + b[0]) / 2 + labelDx, (a[1] + b[1]) / 2 - 10 + labelDy];
}

/**
 * Orientation of the ordered triple, as archify's own segment test uses it.
 * @param a - First point
 * @param b - Second point
 * @param c - Third point
 * @returns 0 when collinear, 1 for a counter-clockwise turn, 2 for clockwise
 */
function orientation(
	a: DiagramPoint,
	b: DiagramPoint,
	c: DiagramPoint,
): number {
	const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
	if (Math.abs(value) < EPSILON) {
		return 0;
	}
	return value > 0 ? 1 : 2;
}

/**
 * True when `b` lies within the bounding box of `a`-`c`, used to resolve the
 * collinear cases of {@link segmentsIntersect}.
 * @param a - One end of the segment
 * @param b - The point to test
 * @param c - The other end
 * @returns True when `b` is inside the segment's bounding box
 */
function onSegment(a: DiagramPoint, b: DiagramPoint, c: DiagramPoint): boolean {
	return (
		b[0] <= Math.max(a[0], c[0]) &&
		b[0] >= Math.min(a[0], c[0]) &&
		b[1] <= Math.max(a[1], c[1]) &&
		b[1] >= Math.min(a[1], c[1])
	);
}

/**
 * True when the two segments cross or touch.
 * @param a - First segment's start
 * @param b - First segment's end
 * @param c - Second segment's start
 * @param d - Second segment's end
 * @returns True when they share at least one point
 */
function segmentsIntersect(
	a: DiagramPoint,
	b: DiagramPoint,
	c: DiagramPoint,
	d: DiagramPoint,
): boolean {
	const first = orientation(a, b, c);
	const second = orientation(a, b, d);
	const third = orientation(c, d, a);
	const fourth = orientation(c, d, b);
	if (first === 0 && onSegment(a, c, b)) {
		return true;
	}
	if (second === 0 && onSegment(a, d, b)) {
		return true;
	}
	if (third === 0 && onSegment(c, a, d)) {
		return true;
	}
	if (fourth === 0 && onSegment(c, b, d)) {
		return true;
	}
	return first !== second && third !== fourth;
}

/**
 * True when the segment passes through the rect, expanded by `gap`.
 * @param start - Segment start
 * @param end - Segment end
 * @param rect - The obstacle
 * @param gap - Clearance to add around the obstacle
 * @returns True when the segment is not clear of it
 */
export function segmentIntersectsRect(
	start: DiagramPoint,
	end: DiagramPoint,
	rect: MeasuredRect,
	gap = 0,
): boolean {
	const x1 = rect.x - gap;
	const y1 = rect.y - gap;
	const x2 = rect.x + rect.width + gap;
	const y2 = rect.y + rect.height + gap;
	const inBox = (point: DiagramPoint) =>
		point[0] >= x1 && point[0] <= x2 && point[1] >= y1 && point[1] <= y2;
	if (inBox(start) || inBox(end)) {
		return true;
	}
	const corners: DiagramPoint[] = [
		[x1, y1],
		[x2, y1],
		[x2, y2],
		[x1, y2],
	];
	return corners.some((corner, index) =>
		segmentsIntersect(
			start,
			end,
			corner,
			corners[(index + 1) % corners.length] as DiagramPoint,
		),
	);
}
