import { describe, expect, it } from 'vitest';

import { compileArchitectureLayout } from '../../src/renderer/lib/architecture-diagram';
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
