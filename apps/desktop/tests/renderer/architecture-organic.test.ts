import { describe, expect, it } from 'vitest';

import { compileArchitectureLayout } from '../../src/renderer/lib/architecture-diagram';
import { pointInPolygon } from '../../src/renderer/lib/architecture-diagram/outline';
import { segmentIntersectsRect } from '../../src/renderer/lib/architecture-diagram/routing';
import { buildSetForest } from '../../src/renderer/lib/architecture-diagram/set-forest';
import type {
	ArchitectureBoundary,
	ArchitectureComponent,
	ArchitectureIR,
	DiagramPoint,
} from '../../src/shared/architecture-diagram';

const component = (id: string): ArchitectureComponent => ({
	id,
	label: id,
	type: 'backend',
});

const document = (
	ids: readonly string[],
	boundaries: readonly ArchitectureBoundary[] = [],
	patch: Partial<ArchitectureIR> = {},
): ArchitectureIR => ({
	boundaries,
	components: ids.map(component),
	layout: { mode: 'organic' },
	meta: { title: 'fixture' },
	schemaVersion: 1,
	...patch,
});

const region = (
	label: string,
	wraps: readonly string[],
): ArchitectureBoundary => ({ kind: 'region', label, wraps });

/** Every corner of a node's box, which is what has to fall inside a frame. */
const cornersOf = (node: {
	height: number;
	width: number;
	x: number;
	y: number;
}): DiagramPoint[] => [
	[node.x, node.y],
	[node.x + node.width, node.y],
	[node.x + node.width, node.y + node.height],
	[node.x, node.y + node.height],
];

/**
 * Reads an island's `d` back into the rectangle it draws, so a containment test
 * runs against the shape on screen rather than against the numbers that built it.
 */
const polygonOf = (d: string): DiagramPoint[] => {
	const coordinates = [...d.matchAll(/[-\d.]+/g)].map(Number);
	const xs = coordinates.filter((_, index) => index % 2 === 0);
	const ys = coordinates.filter((_, index) => index % 2 === 1);
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);
	return [
		[minX, minY],
		[maxX, minY],
		[maxX, maxY],
		[minX, maxY],
	];
};

describe('buildSetForest', () => {
	it('nests a subset inside its smallest superset', () => {
		const forest = buildSetForest(
			[
				region('src', ['a', 'b', 'c']),
				region('src/main', ['a', 'b']),
				region('src/main/deep', ['a']),
			],
			['a', 'b', 'c'],
		);
		expect(forest.roots).toHaveLength(1);
		const root = forest.roots[0];
		expect(root?.set.boundary.label).toBe('src');
		expect(root?.children[0]?.set.boundary.label).toBe('src/main');
		expect(root?.children[0]?.children[0]?.set.boundary.label).toBe(
			'src/main/deep',
		);
	});

	it('hands each member to the deepest region that holds it', () => {
		const forest = buildSetForest(
			[region('outer', ['a', 'b', 'c']), region('inner', ['a', 'b'])],
			['a', 'b', 'c'],
		);
		expect(forest.roots[0]?.own).toEqual(['c']);
		expect(forest.roots[0]?.children[0]?.own).toEqual(['a', 'b']);
	});

	it('makes the larger of a crossing pair the region and the other the lens', () => {
		const forest = buildSetForest(
			[region('left', ['a', 'b']), region('right', ['b', 'c', 'd'])],
			['a', 'b', 'c', 'd'],
		);
		expect(forest.roots.map((root) => root.set.boundary.label)).toEqual([
			'right',
		]);
		expect(forest.crossCutting.map((set) => set.boundary.label)).toEqual([
			'left',
		]);
	});

	it('breaks a same-size crossing by declaration order', () => {
		const forest = buildSetForest(
			[region('first', ['a', 'b']), region('second', ['b', 'c'])],
			['a', 'b', 'c'],
		);
		expect(forest.roots.map((root) => root.set.boundary.label)).toEqual([
			'first',
		]);
		expect(forest.crossCutting.map((set) => set.boundary.label)).toEqual([
			'second',
		]);
	});

	it('reports components no region encloses', () => {
		const forest = buildSetForest([region('src', ['a', 'b'])], ['a', 'b', 'c']);
		expect(forest.loose).toEqual(['c']);
	});

	it('drops a boundary whose members do not exist', () => {
		const forest = buildSetForest([region('ghost', ['nope'])], ['a']);
		expect(forest.roots).toHaveLength(0);
		expect(forest.crossCutting).toHaveLength(0);
	});
});

describe('organic layout: placement', () => {
	it('packs the same document to the same pixels twice', () => {
		const ir = document(
			['a', 'b', 'c', 'd', 'e'],
			[region('src', ['a', 'b', 'c']), region('src/main', ['a', 'b'])],
		);
		const first = compileArchitectureLayout(ir);
		const second = compileArchitectureLayout(ir);
		expect(second.nodes.map((node) => [node.x, node.y])).toEqual(
			first.nodes.map((node) => [node.x, node.y]),
		);
		expect(second.frames.map((frame) => frame.outline)).toEqual(
			first.frames.map((frame) => frame.outline),
		);
	});

	it('places every component, needing neither pos nor row and col', () => {
		const layout = compileArchitectureLayout(
			document(['a', 'b', 'c'], [region('src', ['a', 'b'])]),
		);
		for (const node of layout.nodes) {
			expect(Number.isFinite(node.x)).toBe(true);
			expect(Number.isFinite(node.y)).toBe(true);
		}
		expect(layout.problems).toEqual([]);
	});

	it('leaves no two boxes overlapping', () => {
		const layout = compileArchitectureLayout(
			document(
				['a', 'b', 'c', 'd', 'e', 'f'],
				[region('src', ['a', 'b', 'c', 'd']), region('src/main', ['a', 'b'])],
			),
		);
		for (const left of layout.nodes) {
			for (const right of layout.nodes) {
				if (left.id === right.id) {
					continue;
				}
				const apart =
					left.x + left.width <= right.x ||
					right.x + right.width <= left.x ||
					left.y + left.height <= right.y ||
					right.y + right.height <= left.y;
				expect(apart, `${left.id} overlaps ${right.id}`).toBe(true);
			}
		}
	});
});

describe('organic layout: frames', () => {
	it('draws every region as a closed curve rather than a rectangle', () => {
		const layout = compileArchitectureLayout(
			document(['a', 'b'], [region('src', ['a', 'b'])]),
		);
		const frame = layout.frames[0];
		expect(frame?.outline).toMatch(/^M .* Z$/);
		expect(frame?.isLens).toBe(false);
	});

	it('encloses every member of a region inside the curve it draws', () => {
		const layout = compileArchitectureLayout(
			document(
				['a', 'b', 'c', 'd'],
				[region('src', ['a', 'b', 'c']), region('src/main', ['a', 'b'])],
			),
		);
		for (const frame of layout.frames) {
			const polygon = polygonOf(frame.outline as string);
			for (const id of frame.boundary.wraps) {
				const node = layout.nodes.find((entry) => entry.id === id);
				for (const corner of cornersOf(node as NonNullable<typeof node>)) {
					expect(
						pointInPolygon(corner, polygon),
						`${id} escapes ${frame.boundary.label}`,
					).toBe(true);
				}
			}
		}
	});

	it('keeps a wide region’s curve outside every box it encloses', () => {
		const ids = Array.from(
			{ length: 24 },
			(_, index) => `n${String(index).padStart(2, '0')}`,
		);
		const layout = compileArchitectureLayout(
			document(ids, [region('wide', ids)]),
		);
		const polygon = polygonOf(layout.frames[0]?.outline as string);
		for (const node of layout.nodes) {
			for (const corner of cornersOf(node)) {
				expect(
					pointInPolygon(corner, polygon),
					`${node.id} escapes the outline`,
				).toBe(true);
			}
		}
	});

	it('draws a nested region inside the one that encloses it', () => {
		const layout = compileArchitectureLayout(
			document(
				['a', 'b', 'c', 'd'],
				[region('src', ['a', 'b', 'c']), region('src/main', ['a', 'b'])],
			),
		);
		const outer = layout.frames.find((frame) => frame.boundary.label === 'src');
		const inner = layout.frames.find(
			(frame) => frame.boundary.label === 'src/main',
		);
		const outerPolygon = polygonOf(outer?.outline as string);
		for (const vertex of polygonOf(inner?.outline as string)) {
			expect(pointInPolygon(vertex, outerPolygon)).toBe(true);
		}
		expect(inner?.depth).toBeGreaterThan(outer?.depth as number);
	});

	it('paints parents before the regions they enclose', () => {
		const layout = compileArchitectureLayout(
			document(
				['a', 'b', 'c'],
				[region('src', ['a', 'b', 'c']), region('src/main', ['a', 'b'])],
			),
		);
		const depths = layout.frames.map((frame) => frame.depth);
		expect([...depths].sort((left, right) => left - right)).toEqual(depths);
	});

	it('draws a crossing set as a lens over the region it crosses', () => {
		const layout = compileArchitectureLayout(
			document(
				['a', 'b', 'c'],
				[region('src', ['a', 'b']), region('security', ['b', 'c'])],
			),
		);
		expect(
			layout.frames.map((frame) => [frame.boundary.label, frame.isLens]),
		).toEqual(
			expect.arrayContaining([
				['src', false],
				['security', true],
			]),
		);
	});

	it('keeps a nesting region a region while a crossing set becomes a lens', () => {
		const layout = compileArchitectureLayout(
			document(
				['a', 'b', 'c', 'd'],
				[
					region('src', ['a', 'b', 'c']),
					region('src/main', ['a', 'b']),
					region('security', ['b', 'd']),
				],
			),
		);
		const byLabel = new Map(
			layout.frames.map((frame) => [frame.boundary.label, frame.isLens]),
		);
		expect(byLabel.get('src')).toBe(false);
		expect(byLabel.get('src/main')).toBe(false);
		expect(byLabel.get('security')).toBe(true);
	});

	it('trades a lens member into a slot that faces the rest of its set', () => {
		const ir = document(
			['a', 'b', 'c', 'd', 'e', 'f'],
			[
				region('left', ['a', 'b', 'c']),
				region('right', ['d', 'e', 'f']),
				region('crossing', ['a', 'd']),
			],
		);
		const layout = compileArchitectureLayout(ir);
		const lens = layout.frames.find(
			(frame) => frame.boundary.label === 'crossing',
		);
		expect(lens?.isLens).toBe(true);
		expect(layout.problems).toEqual([]);
		for (const frame of layout.frames.filter((entry) => !entry.isLens)) {
			const polygon = polygonOf(frame.outline as string);
			for (const id of frame.boundary.wraps) {
				const node = layout.nodes.find((entry) => entry.id === id);
				for (const corner of cornersOf(node as NonNullable<typeof node>)) {
					expect(
						pointInPolygon(corner, polygon),
						`${id} left ${frame.boundary.label} during refinement`,
					).toBe(true);
				}
			}
		}
	});

	it('keeps the refinement deterministic', () => {
		const ir = document(
			['a', 'b', 'c', 'd', 'e', 'f'],
			[
				region('left', ['a', 'b', 'c']),
				region('right', ['d', 'e', 'f']),
				region('crossing', ['a', 'd']),
			],
		);
		expect(
			compileArchitectureLayout(ir).nodes.map((node) => [node.x, node.y]),
		).toEqual(
			compileArchitectureLayout(ir).nodes.map((node) => [node.x, node.y]),
		);
	});

	it('reports a lens it cannot draw without swallowing strangers', () => {
		const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
		const layout = compileArchitectureLayout(
			document(ids, [
				region('src', ids.slice(0, 7)),
				region('scattered', ['a', 'h']),
			]),
		);
		const drawn = layout.frames.some(
			(frame) => frame.boundary.label === 'scattered',
		);
		if (!drawn) {
			expect(layout.problems.join(' ')).toContain('scattered');
		} else {
			expect(layout.problems).toEqual([]);
		}
	});

	it('reports a boundary that wraps nothing that exists', () => {
		const layout = compileArchitectureLayout(
			document(['a', 'b'], [region('ghost', ['nope'])]),
		);
		expect(layout.problems).toEqual([
			'Boundary "ghost" wraps no component that exists.',
		]);
	});
});

describe('organic layout: edges', () => {
	it('routes every connection through the lanes rather than across a box', () => {
		const ids = Array.from(
			{ length: 12 },
			(_, index) => `n${String(index).padStart(2, '0')}`,
		);
		const layout = compileArchitectureLayout(
			document(ids, [region('src', ids)], {
				connections: ids.slice(1).map((id) => ({
					from: ids[0] as string,
					id: `e-${id}`,
					to: id,
				})),
			}),
		);
		for (const edge of layout.edges) {
			const endpoints = new Set([edge.connection.from, edge.connection.to]);
			for (const node of layout.nodes) {
				if (endpoints.has(node.id)) {
					continue;
				}
				for (let index = 0; index < edge.points.length - 1; index += 1) {
					expect(
						segmentIntersectsRect(
							edge.points[index] as DiagramPoint,
							edge.points[index + 1] as DiagramPoint,
							node,
							2,
						),
						`${edge.id} passes through ${node.id}`,
					).toBe(false);
				}
			}
		}
	});

	it('anchors an edge on both boxes', () => {
		const layout = compileArchitectureLayout(
			document(['a', 'b'], [region('src', ['a', 'b'])], {
				connections: [{ from: 'a', id: 'e-a-b', to: 'b' }],
			}),
		);
		const edge = layout.edges[0];
		expect(edge?.points.length).toBeGreaterThanOrEqual(2);
		expect(edge?.d.startsWith('M ')).toBe(true);
	});

	it('fans two edges out of one box side rather than stacking them', () => {
		const layout = compileArchitectureLayout(
			document(['a', 'b', 'c'], [region('src', ['a', 'b', 'c'])], {
				connections: [
					{ from: 'a', id: 'to-b', to: 'b' },
					{ from: 'a', id: 'to-c', to: 'c' },
				],
			}),
		);
		const [first, second] = layout.edges;
		expect(first?.points[0]).not.toEqual(second?.points[0]);
	});

	it('honours a pinned label position', () => {
		const layout = compileArchitectureLayout(
			document(['a', 'b'], [region('src', ['a', 'b'])], {
				connections: [
					{ from: 'a', id: 'e-a-b', label: 'reads', labelAt: [5, 6], to: 'b' },
				],
			}),
		);
		expect(layout.edges[0]?.labelAt).toEqual([5, 6]);
	});
});
