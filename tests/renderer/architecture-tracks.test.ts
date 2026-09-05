import { describe, expect, it } from 'vitest';

import { compileArchitectureLayout } from '../../src/renderer/lib/architecture-diagram';
import { resolveGridTracks } from '../../src/renderer/lib/architecture-diagram/tracks';
import type {
	ArchitectureBoundary,
	ArchitectureConnection,
	ArchitectureIR,
} from '../../src/shared/architecture-diagram';

const ir = (over: Partial<ArchitectureIR>): ArchitectureIR => ({
	components: [],
	layout: { cols: 4, mode: 'grid' },
	meta: { title: 'test' },
	schemaVersion: 1,
	...over,
});

const node = (id: string, row: number, col: number) => ({
	col,
	id,
	label: id,
	row,
	type: 'backend' as const,
});

const edge = (from: string, to: string): ArchitectureConnection => ({
	from,
	id: `e-${from}-${to}`,
	to,
});

const region = (label: string, wraps: string[]): ArchitectureBoundary => ({
	kind: 'region',
	label,
	wraps,
});

describe('resolveGridTracks: declared cell geometry is honoured verbatim', () => {
	// The fidelity fixtures pin all four dimensions. If the solver ever second-
	// guesses a document that placed its own boxes, every golden layout moves.
	it('reproduces archify’s uniform offsets when the layout declares them', () => {
		const grid = resolveGridTracks(
			ir({
				components: [node('a', 0, 0), node('b', 1, 2)],
				layout: {
					cellH: 60,
					cellW: 120,
					cols: 7,
					gapX: 24,
					gapY: 48,
					mode: 'grid',
					origin: [40, 100],
				},
			}),
		);

		expect(grid?.colX.slice(0, 3)).toEqual([40, 184, 328]);
		expect(grid?.rowY.slice(0, 2)).toEqual([100, 208]);
	});

	it('treats a single declared dimension as pinning the whole geometry', () => {
		const grid = resolveGridTracks(
			ir({
				components: [node('a', 0, 0), node('b', 1, 1)],
				layout: { cellW: 200, cols: 4, mode: 'grid' },
			}),
		);

		expect(grid?.colX[1]).toBe(40 + 200 + 30);
		expect(grid?.rowY[1]).toBe(80 + 64 + 40);
	});
});

describe('resolveGridTracks: solved tracks', () => {
	it('sizes a column to its widest node', () => {
		const grid = resolveGridTracks(
			ir({
				components: [
					{ ...node('wide', 0, 0), size: [300, 76] },
					node('b', 0, 1),
				],
			}),
		);

		expect(grid?.colX[1]).toBe(40 + 300 + 56);
	});

	it('gives a seam crossed by many edges more room than an empty one', () => {
		const components = [
			node('a', 0, 0),
			node('b', 0, 1),
			node('c', 1, 0),
			node('d', 1, 1),
			node('e', 2, 0),
		];
		const crossings = Array.from({ length: 12 }, (_, index) =>
			index % 2 === 0 ? edge('a', 'c') : edge('b', 'd'),
		).map((connection, index) => ({ ...connection, id: `e-${index}` }));

		const busy = resolveGridTracks(ir({ components, connections: crossings }));
		const quiet = resolveGridTracks(ir({ components }));

		const busySeam = (busy?.rowY[1] ?? 0) - (busy?.rowY[0] ?? 0);
		const quietSeam = (quiet?.rowY[1] ?? 0) - (quiet?.rowY[0] ?? 0);
		expect(busySeam).toBeGreaterThan(quietSeam);
		expect(quietSeam).toBe(76 + 48);
	});

	it('places a component whose col exceeds the declared count', () => {
		const grid = resolveGridTracks(
			ir({
				components: [node('a', 0, 0), node('far', 0, 6)],
				layout: { cols: 2, mode: 'grid' },
			}),
		);

		expect(grid?.colX).toHaveLength(7);
		expect(grid?.colX[6]).toBeGreaterThan(grid?.colX[0] ?? 0);
	});
});

describe('compileArchitectureLayout: lane routing', () => {
	// A same-column edge spanning many rows has no direct candidate that clears
	// anything, and the router's last resort used to draw it straight down
	// through every box between — which reads as connections that do not exist.
	it('routes a long run through the lanes rather than through the boxes', () => {
		const components = Array.from({ length: 6 }, (_, row) => [
			node(`a${row}`, row, 0),
			node(`b${row}`, row, 1),
		]).flat();
		const layout = compileArchitectureLayout(
			ir({ components, connections: [edge('a0', 'a5')] }),
		);

		const [routed] = layout.edges;
		const endpoints = new Set(['a0', 'a5']);
		const crossed = layout.nodes.filter((box) => {
			if (endpoints.has(box.id)) {
				return false;
			}
			return (routed?.points ?? []).some((point, index) => {
				const next = routed?.points[index + 1];
				if (!next) {
					return false;
				}
				const [lowX, highX] = [point[0], next[0]].sort((l, r) => l - r) as [
					number,
					number,
				];
				const [lowY, highY] = [point[1], next[1]].sort((l, r) => l - r) as [
					number,
					number,
				];
				return (
					highX > box.x + 2 &&
					lowX < box.x + box.width - 2 &&
					highY > box.y + 2 &&
					lowY < box.y + box.height - 2
				);
			});
		});

		expect(crossed.map((box) => box.id)).toEqual([]);
	});
});

describe('compileArchitectureLayout: stacked boundary frames', () => {
	// The overlap this guards against was arithmetic: a 104px row pitch against
	// a frame needing 110px, so every band bled into the one below it.
	it('never lets two vertically stacked frames overlap', () => {
		const layout = compileArchitectureLayout(
			ir({
				boundaries: [
					region('upper', ['a', 'b']),
					region('middle', ['c', 'd']),
					region('lower', ['e', 'f']),
				],
				components: [
					node('a', 0, 0),
					node('b', 0, 1),
					node('c', 1, 0),
					node('d', 1, 1),
					node('e', 2, 0),
					node('f', 2, 1),
				],
			}),
		);

		const ordered = [...layout.frames].sort((left, right) => left.y - right.y);
		for (const [index, frame] of ordered.entries()) {
			const next = ordered[index + 1];
			if (next) {
				expect(frame.y + frame.height).toBeLessThan(next.y);
			}
		}
	});

	it('keeps rows inside one frame at the base gap', () => {
		const grid = resolveGridTracks(
			ir({
				boundaries: [region('one', ['a', 'b'])],
				components: [node('a', 0, 0), node('b', 1, 0)],
			}),
		);

		expect((grid?.rowY[1] ?? 0) - (grid?.rowY[0] ?? 0)).toBe(76 + 48);
	});
});
