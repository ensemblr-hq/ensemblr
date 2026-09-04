/**
 * The clear lanes between the diagram's node bands.
 *
 * A long edge belongs in the space *between* boxes, not across them. These are
 * the corridors the router turns into once no direct candidate survives, and
 * the reason the track solver reserves room at every seam.
 */
import type { MeasuredRect } from './routing';

/** Narrowest gap between node bands that can carry a run in the clear. */
const LANE_MINIMUM_WIDTH = 24;

/**
 * The clear lanes between the diagram's node bands on one axis, which is where
 * a long run belongs when no direct route survives.
 *
 * Without these a same-column edge spanning ten rows has no candidate that
 * clears anything, and the router's last resort draws it straight down through
 * every box in between — which reads as ten connections that do not exist.
 * @param nodes - Every measured box
 * @param axis - `x` for the lanes between columns, `y` for those between rows
 * @returns Lane centres, in ascending order
 */
export function clearLanes(
	nodes: readonly MeasuredRect[],
	axis: 'x' | 'y',
): readonly number[] {
	const bands = nodes
		.filter((node) => Number.isFinite(node.x))
		.map(
			(node) =>
				[
					axis === 'x' ? node.x : node.y,
					axis === 'x' ? node.x + node.width : node.y + node.height,
				] as const,
		)
		.sort((left, right) => left[0] - right[0]);
	if (bands.length === 0) {
		return [];
	}
	const lanes: number[] = [];
	let reach = bands[0]?.[1] ?? 0;
	for (const [start, end] of bands) {
		if (start - reach >= LANE_MINIMUM_WIDTH) {
			lanes.push((reach + start) / 2);
		}
		reach = Math.max(reach, end);
	}
	const first = bands[0]?.[0] ?? 0;
	return [first - LANE_MINIMUM_WIDTH, ...lanes, reach + LANE_MINIMUM_WIDTH];
}

/**
 * The lane nearest a coordinate, which is the one a route should turn into.
 * @param lanes - Lane centres on that axis
 * @param near - Coordinate to be close to
 * @returns The nearest lane, or null when the axis has none
 */
export function nearestLane(
	lanes: readonly number[],
	near: number,
): number | null {
	let best: number | null = null;
	for (const lane of lanes) {
		if (best === null || Math.abs(lane - near) < Math.abs(best - near)) {
			best = lane;
		}
	}
	return best;
}
