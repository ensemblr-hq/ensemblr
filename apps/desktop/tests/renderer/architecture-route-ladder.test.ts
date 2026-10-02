import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
	ArchitectureComponent,
	ArchitectureConnection,
	ArchitectureIR,
	DiagramPoint,
} from '../../src/shared/architecture-diagram';

// `nearestLane` is reached from exactly one place — the lane sweep at the foot
// of the candidate ladder — so a call to it is the observable signal that the
// sweep ran. Spying on it is how the laziness below is pinned without timing.
vi.mock(
	'../../src/renderer/lib/architecture-diagram/lanes',
	async (original) => {
		const actual =
			await original<
				typeof import('../../src/renderer/lib/architecture-diagram/lanes')
			>();
		return { ...actual, nearestLane: vi.fn(actual.nearestLane) };
	},
);

const { compileArchitectureLayout } = await import(
	'../../src/renderer/lib/architecture-diagram/compile'
);
const { nearestLane } = await import(
	'../../src/renderer/lib/architecture-diagram/lanes'
);

const sweptForLanes = () => vi.mocked(nearestLane).mock.calls.length > 0;

const cell = (id: string, row: number, col: number): ArchitectureComponent => ({
	col,
	id,
	label: id,
	row,
	type: 'backend',
});

const grid = (
	components: readonly ArchitectureComponent[],
	connections: readonly ArchitectureConnection[],
	cols: number,
): ArchitectureIR => ({
	components: [...components],
	connections: [...connections],
	layout: { cols, mode: 'grid' },
	meta: { title: 'ladder' },
	schemaVersion: 1,
});

/** A column of `rows` boxes, one per row, in a single-column grid. */
const column = (rows: number): ArchitectureComponent[] =>
	Array.from({ length: rows }, (_, row) => cell(`n${row}`, row, 0));

/** A `rows` × 3 grid, which is what leaves clear lanes between the bands. */
const band = (rows: number): ArchitectureComponent[] =>
	Array.from({ length: rows }, (_, row) => [
		cell(`n${row}-0`, row, 0),
		cell(`n${row}-1`, row, 1),
		cell(`n${row}-2`, row, 2),
	]).flat();

beforeEach(() => {
	vi.mocked(nearestLane).mockClear();
});

describe('the candidate ladder is walked lazily', () => {
	it('never builds the lane sweep when a dogleg already answers the edge', () => {
		const layout = compileArchitectureLayout(
			grid(band(2), [{ from: 'n0-0', id: 'e-1', to: 'n1-2' }], 3),
		);

		expect(layout.edges[0]?.points).toHaveLength(4);
		expect(sweptForLanes()).toBe(false);
	});

	it('leaves the lane sweep unbuilt for a whole grid of dogleg edges', () => {
		const rows = 24;
		const connections = Array.from({ length: rows - 1 }, (_, index) => ({
			from: `n${index}-0`,
			id: `e-${index}`,
			to: `n${index + 1}-2`,
		}));
		const layout = compileArchitectureLayout(grid(band(rows), connections, 3));

		expect(layout.edges).toHaveLength(rows - 1);
		expect(layout.edges.every((edge) => edge.points.length === 4)).toBe(true);
		expect(sweptForLanes()).toBe(false);
	});

	it('still reaches the lane sweep when nothing earlier survives', () => {
		const rows = 8;
		compileArchitectureLayout(
			grid(column(rows), [{ from: 'n0', id: 'e-1', to: `n${rows - 1}` }], 1),
		);

		expect(sweptForLanes()).toBe(true);
	});

	it('routes a long same-column edge clear of every box in between', () => {
		const rows = 8;
		const layout = compileArchitectureLayout(
			grid(column(rows), [{ from: 'n0', id: 'e-1', to: `n${rows - 1}` }], 1),
		);
		const points = layout.edges[0]?.points ?? [];
		const between = layout.nodes.slice(1, -1);

		expect(points.length).toBeGreaterThan(2);
		for (const node of between) {
			expect(segmentsClearOf(points, node)).toBe(true);
		}
	});
});

describe('a self-loop', () => {
	const loopIr = (
		over: Partial<ArchitectureConnection> = {},
	): ArchitectureIR => ({
		components: [
			{ id: 'a', label: 'a', pos: [40, 80], size: [168, 76], type: 'backend' },
		],
		connections: [{ from: 'a', id: 'e-loop', to: 'a', ...over }],
		layout: { cols: 4, mode: 'grid' },
		meta: { title: 'loop' },
		schemaVersion: 1,
	});

	it('is drawn rather than reported', () => {
		const layout = compileArchitectureLayout(loopIr());

		expect(layout.problems).toEqual([]);
		expect(layout.edges).toHaveLength(1);
		expect(layout.edges[0]?.d).not.toBe('');
	});

	it('never crosses the box it leaves and returns to', () => {
		const layout = compileArchitectureLayout(loopIr());
		const node = layout.nodes[0];
		const points = layout.edges[0]?.points ?? [];

		expect(node).toBeDefined();
		expect(
			segmentsClearOf(
				points,
				node as { height: number; width: number; x: number; y: number },
			),
		).toBe(true);
	});

	it('starts and ends on two different sides of its own box', () => {
		const layout = compileArchitectureLayout(loopIr());
		const points = layout.edges[0]?.points ?? [];
		const start = points[0] as DiagramPoint;
		const end = points.at(-1) as DiagramPoint;

		expect(start).not.toEqual(end);
		expect(start[0]).toBe(208);
		expect(end[1]).toBe(80);
	});

	it('honours an authored via rather than the built-in lobe', () => {
		const layout = compileArchitectureLayout(loopIr({ via: [[900, 900]] }));

		expect(layout.edges[0]?.points).toContainEqual([900, 900]);
	});

	it('does not consume a port slot from the other edges on that box', () => {
		const withLoop = compileArchitectureLayout({
			components: [
				{
					id: 'a',
					label: 'a',
					pos: [40, 80],
					size: [168, 76],
					type: 'backend',
				},
				{
					id: 'b',
					label: 'b',
					pos: [400, 80],
					size: [168, 76],
					type: 'backend',
				},
			],
			connections: [
				{ from: 'a', id: 'e-loop', to: 'a' },
				{ from: 'a', id: 'e-ab', to: 'b' },
			],
			layout: { cols: 4, mode: 'grid' },
			meta: { title: 'loop' },
			schemaVersion: 1,
		});
		const withoutLoop = compileArchitectureLayout({
			components: [
				{
					id: 'a',
					label: 'a',
					pos: [40, 80],
					size: [168, 76],
					type: 'backend',
				},
				{
					id: 'b',
					label: 'b',
					pos: [400, 80],
					size: [168, 76],
					type: 'backend',
				},
			],
			connections: [{ from: 'a', id: 'e-ab', to: 'b' }],
			layout: { cols: 4, mode: 'grid' },
			meta: { title: 'loop' },
			schemaVersion: 1,
		});
		const anchored = (layout: {
			edges: readonly { id: string; points: readonly DiagramPoint[] }[];
		}) => layout.edges.find((edge) => edge.id === 'e-ab')?.points[0];

		expect(anchored(withLoop)).toEqual(anchored(withoutLoop));
	});
});

/**
 * True when no segment of a route passes through a box.
 * @param points - The route to check
 * @param box - The box it must stay clear of
 * @returns True when every segment misses the box
 */
function segmentsClearOf(
	points: readonly DiagramPoint[],
	box: { height: number; width: number; x: number; y: number },
): boolean {
	const inside = (point: DiagramPoint) =>
		point[0] > box.x &&
		point[0] < box.x + box.width &&
		point[1] > box.y &&
		point[1] < box.y + box.height;
	for (let index = 0; index < points.length - 1; index += 1) {
		const start = points[index] as DiagramPoint;
		const end = points[index + 1] as DiagramPoint;
		const steps = 24;
		for (let step = 0; step <= steps; step += 1) {
			const ratio = step / steps;
			const sample: DiagramPoint = [
				start[0] + (end[0] - start[0]) * ratio,
				start[1] + (end[1] - start[1]) * ratio,
			];
			if (inside(sample)) {
				return false;
			}
		}
	}
	return true;
}
