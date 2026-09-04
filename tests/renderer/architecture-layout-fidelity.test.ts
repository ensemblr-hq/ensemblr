import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { compileArchitectureLayout } from '../../src/renderer/lib/architecture-diagram';
import { parseArchitectureIr } from '../../src/shared/architecture-diagram';

const FIXTURES = fileURLToPath(
	new URL('../fixtures/architecture/', import.meta.url),
);

/** Golden layout as archify's own renderer reported it, trimmed to the ported fields. */
interface GoldenLayout {
	boundaries: readonly {
		height: number;
		kind: string;
		label: string;
		width: number;
		x: number;
		y: number;
	}[];
	components: readonly {
		height: number;
		id: string;
		width: number;
		x: number;
		y: number;
	}[];
	connections: readonly {
		from: string;
		labelAt?: readonly [number, number];
		points: readonly (readonly [number, number])[];
		to: string;
	}[];
	viewBox: readonly [number, number];
}

const readJson = <T>(name: string): T =>
	JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8')) as T;

const CASES = [
	{
		document: 'web-app.architecture.json',
		golden: 'web-app.layout.json',
		name: 'free placement (web-app)',
	},
	{
		document: 'grid.architecture.json',
		golden: 'grid.layout.json',
		name: 'grid placement (archify-repo-grid)',
	},
] as const;

describe.each(CASES)(
	'architecture layout fidelity: $name',
	({ document, golden }) => {
		const ir = parseArchitectureIr(readJson(document));
		const expected = readJson<GoldenLayout>(golden);

		it('loads an archify-authored document unchanged', () => {
			expect(ir).not.toBeNull();
		});

		it('places every component where archify places it', () => {
			const layout = compileArchitectureLayout(ir as NonNullable<typeof ir>);
			expect(
				layout.nodes.map((node) => ({
					height: node.height,
					id: node.id,
					width: node.width,
					x: node.x,
					y: node.y,
				})),
			).toEqual(expected.components);
		});

		it('sizes every boundary frame the way archify sizes it', () => {
			const layout = compileArchitectureLayout(ir as NonNullable<typeof ir>);
			expect(
				layout.frames.map((frame) => ({
					height: frame.height,
					kind: frame.boundary.kind,
					label: frame.boundary.label,
					width: frame.width,
					x: frame.x,
					y: frame.y,
				})),
			).toEqual(expected.boundaries);
		});

		it('routes every connection through archify’s own points', () => {
			const layout = compileArchitectureLayout(ir as NonNullable<typeof ir>);
			expect(
				layout.edges.map((edge) => ({
					from: edge.connection.from,
					...(edge.labelAt ? { labelAt: edge.labelAt } : {}),
					points: edge.points,
					to: edge.connection.to,
				})),
			).toEqual(
				expected.connections.map((connection) => ({
					from: connection.from,
					...(connection.labelAt ? { labelAt: connection.labelAt } : {}),
					points: connection.points,
					to: connection.to,
				})),
			);
		});

		it('reports no placement problems for a document archify accepts', () => {
			const layout = compileArchitectureLayout(ir as NonNullable<typeof ir>);
			expect(layout.problems).toEqual([]);
		});
	},
);

describe('architecture layout: viewBox', () => {
	// archify's viewBox additionally reserves height for the legend it draws into
	// the artifact, which this app renders as its own footer outside the SVG. The
	// width is the part the geometry decides, so that is what the golden pins.
	it('derives the same canvas width as archify', () => {
		for (const testCase of CASES) {
			const ir = parseArchitectureIr(readJson(testCase.document));
			const expected = readJson<GoldenLayout>(testCase.golden);
			const layout = compileArchitectureLayout(ir as NonNullable<typeof ir>);
			expect(layout.viewBox[0], testCase.name).toBe(expected.viewBox[0]);
		}
	});
});
