/**
 * The closed shape drawn around a set's members.
 *
 * An island is a rounded rectangle around the bounding box of what it holds,
 * standing off by its own padding. Rectangular rather than a hull hugging the
 * boxes: the members inside are laid out in rows, so a rectangle is already the
 * shape they fill, and a curve drawn around a grid only wastes the corners.
 *
 * The Euler reading survives the square corners intact. Nesting comes out for
 * free — a parent's members are a superset of each child's and its padding is
 * larger, so a parent rectangle provably contains the child's — and two sets
 * that share members overlap into a lens exactly as two circles would.
 */
import type { DiagramPoint } from '@/shared/architecture-diagram';

/** A box the outline has to enclose. */
export interface OutlineRect {
	height: number;
	width: number;
	x: number;
	y: number;
}

/** How round an island's corners are. */
const CORNER_RADIUS = 14;

/**
 * True when a point falls inside a closed polygon, by ray casting. Used to ask
 * whether a lens would swallow something it does not wrap.
 * @param point - The point to test
 * @param polygon - The closed polygon's vertices
 * @returns True when the point is inside
 */
export function pointInPolygon(
	point: DiagramPoint,
	polygon: readonly DiagramPoint[],
): boolean {
	let inside = false;
	for (let index = 0; index < polygon.length; index += 1) {
		const a = polygon[index] as DiagramPoint;
		const b = polygon[(index + 1) % polygon.length] as DiagramPoint;
		const straddles = a[1] > point[1] !== b[1] > point[1];
		if (!straddles) {
			continue;
		}
		const crossingX =
			((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
		if (point[0] < crossingX) {
			inside = !inside;
		}
	}
	return inside;
}

/**
 * Trims a coordinate to the precision the SVG needs, so the path string stays
 * stable across rebuilds instead of churning on floating-point noise.
 * @param value - The coordinate
 * @returns The coordinate at two decimal places
 */
function round(value: number): number {
	return Math.round(value * 100) / 100;
}

/**
 * Serializes a rectangle as a closed path with rounded corners.
 * @param rect - The rectangle to draw
 * @returns An SVG `d` attribute for the closed shape
 */
function roundedRectPath(rect: OutlineRect): string {
	const radius = Math.min(CORNER_RADIUS, rect.width / 2, rect.height / 2);
	const right = rect.x + rect.width;
	const bottom = rect.y + rect.height;
	return [
		`M ${round(rect.x + radius)} ${round(rect.y)}`,
		`H ${round(right - radius)}`,
		`A ${radius} ${radius} 0 0 1 ${round(right)} ${round(rect.y + radius)}`,
		`V ${round(bottom - radius)}`,
		`A ${radius} ${radius} 0 0 1 ${round(right - radius)} ${round(bottom)}`,
		`H ${round(rect.x + radius)}`,
		`A ${radius} ${radius} 0 0 1 ${round(rect.x)} ${round(bottom - radius)}`,
		`V ${round(rect.y + radius)}`,
		`A ${radius} ${radius} 0 0 1 ${round(rect.x + radius)} ${round(rect.y)}`,
		'Z',
	].join(' ');
}

/**
 * The island around a set of boxes: its rectangle, the polygon a containment
 * test reads, and the path the surface draws.
 * @param rects - The boxes the island must enclose
 * @param pad - How far outside the boxes the island stands off
 * @returns The island, or null when there is nothing to enclose
 */
export function regionOutline(
	rects: readonly OutlineRect[],
	pad: number,
): { d: string; polygon: readonly DiagramPoint[]; rect: OutlineRect } | null {
	if (rects.length === 0) {
		return null;
	}
	const minX = Math.min(...rects.map((entry) => entry.x)) - pad;
	const minY = Math.min(...rects.map((entry) => entry.y)) - pad;
	const maxX = Math.max(...rects.map((entry) => entry.x + entry.width)) + pad;
	const maxY = Math.max(...rects.map((entry) => entry.y + entry.height)) + pad;
	const rect: OutlineRect = {
		height: maxY - minY,
		width: maxX - minX,
		x: minX,
		y: minY,
	};
	return {
		d: roundedRectPath(rect),
		polygon: [
			[minX, minY],
			[maxX, minY],
			[maxX, maxY],
			[minX, maxY],
		],
		rect,
	};
}
