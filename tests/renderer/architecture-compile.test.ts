import { describe, expect, it } from 'vitest';

import { compileArchitectureLayout } from '../../src/renderer/lib/architecture-diagram';
import {
	MAX_GRID_TRACKS,
	resolveGridTracks,
} from '../../src/renderer/lib/architecture-diagram/tracks';
import type {
	ArchitectureComponent,
	ArchitectureIR,
} from '../../src/shared/architecture-diagram';

const component = (
	id: string,
	row: number,
	col: number,
): ArchitectureComponent => ({
	col,
	id,
	label: id,
	row,
	type: 'backend',
});

const document = (patch: Partial<ArchitectureIR> = {}): ArchitectureIR => ({
	components: [component('alpha', 0, 0), component('beta', 0, 2)],
	layout: { cols: 4, mode: 'grid' },
	meta: { title: 'fixture' },
	schemaVersion: 1,
	...patch,
});

describe('compileArchitectureLayout: boundaries', () => {
	it('wraps every member inside the frame it draws', () => {
		const layout = compileArchitectureLayout(
			document({
				boundaries: [
					{ kind: 'region', label: 'Core', wraps: ['alpha', 'beta'] },
				],
			}),
		);
		const frame = layout.frames[0];
		expect(frame).toBeDefined();
		for (const node of layout.nodes) {
			expect(node.x).toBeGreaterThanOrEqual(frame?.x ?? 0);
			expect(node.y).toBeGreaterThanOrEqual(frame?.y ?? 0);
			expect(node.x + node.width).toBeLessThanOrEqual(
				(frame?.x ?? 0) + (frame?.width ?? 0),
			);
			expect(node.y + node.height).toBeLessThanOrEqual(
				(frame?.y ?? 0) + (frame?.height ?? 0),
			);
		}
	});

	it('reserves twice the title band for a CJK label as for its ASCII width', () => {
		const titleWidth = (label: string) =>
			compileArchitectureLayout(
				document({
					boundaries: [{ kind: 'region', label, wraps: ['alpha', 'beta'] }],
				}),
			).frames[0]?.title.width;

		expect(titleWidth('認証')).toBe(titleWidth('abcd'));
	});

	it('reserves twice the title band for an emoji label as for one ASCII glyph', () => {
		const titleWidth = (label: string) =>
			compileArchitectureLayout(
				document({
					boundaries: [{ kind: 'region', label, wraps: ['alpha', 'beta'] }],
				}),
			).frames[0]?.title.width;

		expect(titleWidth('🚀')).toBe(titleWidth('ab'));
	});

	it('reports a boundary whose members do not exist rather than drawing it', () => {
		const layout = compileArchitectureLayout(
			document({
				boundaries: [{ kind: 'region', label: 'Ghost', wraps: ['missing'] }],
			}),
		);
		expect(layout.frames).toEqual([]);
		expect(layout.problems).toEqual([
			'Boundary "Ghost" wraps no component that exists.',
		]);
	});
});

describe('compileArchitectureLayout: connections', () => {
	it('leaves an explicitly sided edge on the sides it names', () => {
		const layout = compileArchitectureLayout(
			document({
				connections: [
					{
						from: 'alpha',
						fromSide: 'bottom',
						id: 'e-1',
						to: 'beta',
						toSide: 'bottom',
					},
				],
			}),
		);
		const edge = layout.edges[0];
		const [alpha, beta] = layout.nodes;
		expect(edge?.points[0]).toEqual([
			alpha?.cx,
			(alpha?.y ?? 0) + (alpha?.height ?? 0),
		]);
		expect(edge?.points.at(-1)).toEqual([
			beta?.cx,
			(beta?.y ?? 0) + (beta?.height ?? 0),
		]);
	});

	it('reports a connection naming a component that does not exist', () => {
		const layout = compileArchitectureLayout(
			document({
				connections: [{ from: 'alpha', id: 'e-1', to: 'nowhere' }],
			}),
		);
		expect(layout.edges).toEqual([]);
		expect(layout.problems).toEqual([
			'Connection "e-1" references a component that does not exist.',
		]);
	});

	it('honours an authored via path verbatim', () => {
		const layout = compileArchitectureLayout(
			document({
				connections: [
					{ from: 'alpha', id: 'e-1', to: 'beta', via: [[500, 500]] },
				],
			}),
		);
		expect(layout.edges[0]?.points[1]).toEqual([500, 500]);
	});
});

describe('compileArchitectureLayout: grid placement faults', () => {
	it('reports a column past the grid width', () => {
		const layout = compileArchitectureLayout(
			document({ components: [component('alpha', 0, 9)] }),
		);
		expect(layout.problems).toEqual([
			'Component "alpha" col 9 exceeds layout.cols 4 (valid: 0..3).',
		]);
	});

	it('reports two components sharing one cell', () => {
		const layout = compileArchitectureLayout(
			document({
				components: [component('alpha', 1, 1), component('beta', 1, 1)],
			}),
		);
		expect(layout.problems).toEqual([
			'Components "alpha" and "beta" share grid cell row 1 col 1.',
		]);
	});

	it('reports a component with neither a cell nor a position', () => {
		const layout = compileArchitectureLayout(
			document({
				components: [{ id: 'alpha', label: 'alpha', type: 'backend' }],
			}),
		);
		expect(layout.problems).toEqual([
			'Component "alpha" needs pos [x,y] or grid row/col.',
		]);
	});

	it('reports two components pinned to the same point, not only the same cell', () => {
		const layout = compileArchitectureLayout(
			document({
				components: [
					{ id: 'alpha', label: 'alpha', pos: [100, 100], type: 'backend' },
					{ id: 'beta', label: 'beta', pos: [100, 100], type: 'backend' },
				],
			}),
		);
		expect(layout.problems).toEqual([
			'Components "alpha" and "beta" are placed at the same point [100, 100].',
		]);
	});

	it('leaves two components at different points alone', () => {
		const layout = compileArchitectureLayout(
			document({
				components: [
					{ id: 'alpha', label: 'alpha', pos: [100, 100], type: 'backend' },
					{ id: 'beta', label: 'beta', pos: [100, 300], type: 'backend' },
				],
			}),
		);
		expect(layout.problems).toEqual([]);
	});
});

describe('compileArchitectureLayout: the track ceiling', () => {
	// An unbounded `col` used to allocate one track per index: 50,000,000 froze
	// the compile for seconds, and a row past 2^31 aborted V8's allocator
	// outright, which no error boundary can catch.
	it.each([
		{ axis: 'col' as const, index: 50_000_000 },
		{ axis: 'row' as const, index: 2_147_483_648 },
	])('clamps an untrusted $axis and reports it', ({ axis, index }) => {
		const started = performance.now();
		const layout = compileArchitectureLayout(
			document({
				components: [
					{
						...component('alpha', 0, 0),
						[axis]: index,
					} as ArchitectureComponent,
				],
			}),
		);

		expect(performance.now() - started).toBeLessThan(1000);
		expect(layout.problems).toContain(
			`Component "alpha" ${axis} ${index} exceeds the ${MAX_GRID_TRACKS} ${axis === 'col' ? 'columns' : 'rows'} a diagram can hold (valid: 0..${MAX_GRID_TRACKS - 1}).`,
		);
	});

	it('keeps the canvas finite when every component is out of range', () => {
		const layout = compileArchitectureLayout(
			document({
				components: [{ ...component('alpha', 0, 0), col: 50_000_000 }],
			}),
		);

		expect(layout.viewBox.every(Number.isFinite)).toBe(true);
		expect(layout.viewBox[0]).toBeLessThan(100_000);
	});

	it('solves a grid right up to the ceiling without clamping it', () => {
		const grid = resolveGridTracks(
			document({
				components: [component('alpha', MAX_GRID_TRACKS - 1, 0)],
			}),
		);

		expect(grid?.rowY).toHaveLength(MAX_GRID_TRACKS);
		expect(grid?.rowY.every(Number.isFinite)).toBe(true);
	});
});

describe('compileArchitectureLayout: a declared viewBox that clips', () => {
	it('keeps the declared box but reports what it cuts off', () => {
		const layout = compileArchitectureLayout(
			document({
				components: [
					{ id: 'alpha', label: 'alpha', pos: [700, 1000], type: 'backend' },
				],
				meta: { title: 'fixture', viewBox: [100, 100] },
			}),
		);

		expect(layout.viewBox).toEqual([100, 100]);
		expect(layout.problems).toHaveLength(1);
		expect(layout.problems[0]).toMatch(
			/^Declared meta\.viewBox 100x100 is smaller than the \d+x\d+ its content fills; the rest is clipped\.$/,
		);
	});

	it('says nothing about a declared box that holds its content', () => {
		const layout = compileArchitectureLayout(
			document({ meta: { title: 'fixture', viewBox: [4000, 4000] } }),
		);

		expect(layout.viewBox).toEqual([4000, 4000]);
		expect(layout.problems).toEqual([]);
	});
});

describe('compileArchitectureLayout: an empty document', () => {
	it.each([
		{ layout: { cols: 4, mode: 'grid' as const }, mode: 'grid' },
		{ layout: { mode: 'organic' as const }, mode: 'organic' },
	])('compiles to clean, finite output in $mode mode', ({ layout }) => {
		const compiled = compileArchitectureLayout({
			components: [],
			layout,
			meta: { title: 'empty' },
			schemaVersion: 1,
		});

		expect(compiled.edges).toEqual([]);
		expect(compiled.frames).toEqual([]);
		expect(compiled.nodes).toEqual([]);
		expect(compiled.problems).toEqual([]);
		expect(compiled.viewBox.every(Number.isFinite)).toBe(true);
	});
});

describe('compileArchitectureLayout: organic mode ignores authored placement', () => {
	const organic = (components: readonly ArchitectureComponent[]) =>
		compileArchitectureLayout({
			components: [...components],
			layout: { mode: 'organic' },
			meta: { title: 'organic' },
			schemaVersion: 1,
		});

	it('reports a pos the packer overrode rather than dropping it silently', () => {
		const layout = organic([
			{ id: 'alpha', label: 'alpha', pos: [5000, 5000], type: 'backend' },
		]);

		expect(layout.problems).toEqual([
			'Component "alpha" declares pos, which organic layout ignores.',
		]);
		expect(layout.nodes[0]?.x).not.toBe(5000);
	});

	it('reports a row/col the packer overrode', () => {
		const layout = organic([component('beta', 3, 2)]);

		expect(layout.problems).toEqual([
			'Component "beta" declares row/col, which organic layout ignores.',
		]);
	});

	it('names both when a component declares both', () => {
		const layout = organic([
			{ ...component('gamma', 3, 2), pos: [10, 10] as const },
		]);

		expect(layout.problems).toEqual([
			'Component "gamma" declares pos and row/col, which organic layout ignores.',
		]);
	});

	it('says nothing about a component that declares no placement', () => {
		const layout = organic([{ id: 'delta', label: 'delta', type: 'backend' }]);

		expect(layout.problems).toEqual([]);
	});
});

describe('compileArchitectureLayout: viewBox', () => {
	it('honours a declared viewBox rather than deriving one', () => {
		const layout = compileArchitectureLayout(
			document({ meta: { title: 'fixture', viewBox: [1234, 567] } }),
		);
		expect(layout.viewBox).toEqual([1234, 567]);
	});

	it('derives a canvas that clears the furthest node', () => {
		const layout = compileArchitectureLayout(document());
		const furthestX = Math.max(
			...layout.nodes.map((node) => node.x + node.width),
		);
		expect(layout.viewBox[0]).toBeGreaterThan(furthestX);
	});
});
