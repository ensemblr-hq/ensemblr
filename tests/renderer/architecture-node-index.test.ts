/**
 * The router narrows a segment's clearance test to the boxes near it. A query
 * that misses a box the segment actually crosses draws an edge through a
 * component, so the index's contract is that it never under-reports.
 */

import { describe, expect, it } from 'vitest';

import type { DiagramNode } from '@/renderer/lib/architecture-diagram/layout-types';
import { nodeIndexFor } from '@/renderer/lib/architecture-diagram/node-index';

function node(id: string, x: number, y: number): DiagramNode {
	return {
		component: { id, label: id },
		cx: x + 60,
		cy: y + 20,
		height: 40,
		id,
		width: 120,
		x,
		y,
	} as unknown as DiagramNode;
}

/** A grid of boxes wide enough that bucketing engages (16-node floor). */
function gridOfNodes(columns: number, rows: number): DiagramNode[] {
	return Array.from({ length: columns * rows }, (_, index) =>
		node(
			`n${index}`,
			(index % columns) * 200,
			Math.floor(index / columns) * 100,
		),
	);
}

function overlaps(
	candidate: DiagramNode,
	minX: number,
	minY: number,
	maxX: number,
	maxY: number,
): boolean {
	return (
		candidate.x <= maxX &&
		candidate.x + candidate.width >= minX &&
		candidate.y <= maxY &&
		candidate.y + candidate.height >= minY
	);
}

describe('nodeIndexFor', () => {
	const nodes = gridOfNodes(10, 10);
	const index = nodeIndexFor(nodes);

	it('returns every node a query rectangle actually overlaps', () => {
		for (let x = -300; x <= 2200; x += 137) {
			for (let y = -300; y <= 1200; y += 91) {
				const query = [x, y, x + 250, y + 150] as const;
				const reported = new Set(index.near(...query).map((it) => it.id));
				const expected = nodes.filter((it) => overlaps(it, ...query));

				for (const missed of expected) {
					expect(reported.has(missed.id), `${missed.id} at ${query}`).toBe(
						true,
					);
				}
			}
		}
	});

	it('narrows a small query well below the whole set', () => {
		expect(index.near(0, 0, 100, 50).length).toBeLessThan(nodes.length / 4);
	});

	it('reuses one index per node array, so a compile builds it once', () => {
		expect(nodeIndexFor(nodes)).toBe(index);
		expect(nodeIndexFor([...nodes])).not.toBe(index);
	});

	// A node the solver could not place carries NaN coordinates and belongs to no
	// bucket; dropping it would change which nodes the clearance test sees.
	it('returns unplaced nodes from every query', () => {
		const unplaced = { ...node('ghost', 0, 0), x: Number.NaN, y: Number.NaN };
		const withGhost = nodeIndexFor([...gridOfNodes(10, 10), unplaced]);

		expect(
			withGhost.near(9_000, 9_000, 9_100, 9_100).map((it) => it.id),
		).toEqual(['ghost']);
	});

	it('falls back to the whole set for a diagram too small to bucket', () => {
		const few = gridOfNodes(2, 2);

		expect(nodeIndexFor(few).near(9_000, 9_000, 9_100, 9_100)).toHaveLength(4);
	});

	it('falls back to the whole set when every node sits at one point', () => {
		const stacked = Array.from({ length: 20 }, (_, i) => node(`s${i}`, 0, 0));

		expect(nodeIndexFor(stacked).near(0, 0, 1, 1)).toHaveLength(20);
	});
});
