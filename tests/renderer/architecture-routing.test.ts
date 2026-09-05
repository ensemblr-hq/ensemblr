import { describe, expect, it } from 'vitest';

import type { MeasuredRect } from '../../src/renderer/lib/architecture-diagram/routing';
import {
	anchor,
	chosenSide,
	defaultFromSide,
	defaultToSide,
	isVerticalSide,
	labelPoint,
	normalizeRoutePoints,
	polylinePath,
	roundedPath,
	routeHonorsEndpointSides,
} from '../../src/renderer/lib/architecture-diagram/routing';
import type {
	ArchitectureConnection,
	DiagramPoint,
} from '../../src/shared/architecture-diagram';

const rect = (
	x: number,
	y: number,
	width = 100,
	height = 60,
): MeasuredRect => ({
	cx: x + width / 2,
	cy: y + height / 2,
	height,
	id: `${x},${y}`,
	width,
	x,
	y,
});

const edge = (
	over: Partial<ArchitectureConnection> = {},
): ArchitectureConnection => ({
	from: 'a',
	id: 'e-1',
	to: 'b',
	...over,
});

describe('anchor', () => {
	const box = rect(40, 80);

	it.each([
		{ expected: [40, 110], side: 'left' as const },
		{ expected: [140, 110], side: 'right' as const },
		{ expected: [90, 80], side: 'top' as const },
		{ expected: [90, 140], side: 'bottom' as const },
	])('puts a $side anchor on that border', ({ expected, side }) => {
		expect(anchor(box, side)).toEqual(expected);
	});

	it('places every anchor on the box outline', () => {
		for (const side of ['bottom', 'left', 'right', 'top'] as const) {
			const [x, y] = anchor(box, side);
			expect(x).toBeGreaterThanOrEqual(box.x);
			expect(x).toBeLessThanOrEqual(box.x + box.width);
			expect(y).toBeGreaterThanOrEqual(box.y);
			expect(y).toBeLessThanOrEqual(box.y + box.height);
		}
	});
});

describe('normalizeRoutePoints', () => {
	it('drops a non-finite point rather than carrying NaN into the path', () => {
		expect(
			normalizeRoutePoints([
				[0, 0],
				[Number.NaN, 10],
				[0, 20],
			]),
		).toEqual([
			[0, 0],
			[0, 20],
		]);
	});

	it('collapses coincident points', () => {
		expect(
			normalizeRoutePoints([
				[0, 0],
				[0, 0],
				[10, 0],
			]),
		).toEqual([
			[0, 0],
			[10, 0],
		]);
	});

	it('drops a collinear vertex, keeping only the corners a route turns at', () => {
		expect(
			normalizeRoutePoints([
				[0, 0],
				[10, 0],
				[20, 0],
				[20, 30],
			]),
		).toEqual([
			[0, 0],
			[20, 0],
			[20, 30],
		]);
	});

	it('keeps an empty route empty', () => {
		expect(normalizeRoutePoints([])).toEqual([]);
	});
});

describe('polylinePath', () => {
	it('serializes a move followed by one line per point', () => {
		expect(
			polylinePath([
				[0, 0],
				[10, 0],
				[10, 20],
			]),
		).toBe('M 0 0 L 10 0 L 10 20');
	});

	// An empty `d` is an SVG parse error rather than an invisible path, so the
	// callers upstream have to hold a route to at least two points.
	it('yields an empty d for an empty route', () => {
		expect(polylinePath([])).toBe('');
	});

	it('yields a bare move for a single point', () => {
		expect(polylinePath([[5, 7]])).toBe('M 5 7');
	});
});

describe('roundedPath', () => {
	it('falls back to straight corners for a two-point route', () => {
		const points: DiagramPoint[] = [
			[0, 0],
			[100, 0],
		];
		expect(roundedPath(points, 8)).toBe(polylinePath(points));
	});

	it('falls back to straight corners at a zero radius', () => {
		const points: DiagramPoint[] = [
			[0, 0],
			[50, 0],
			[50, 50],
		];
		expect(roundedPath(points, 0)).toBe(polylinePath(points));
	});

	it('rounds an interior corner with a quadratic', () => {
		const d = roundedPath(
			[
				[0, 0],
				[50, 0],
				[50, 50],
			],
			8,
		);
		expect(d).toContain('Q 50 0');
		expect(d.startsWith('M 0 0')).toBe(true);
		expect(d.endsWith('L 50 50')).toBe(true);
	});

	it('drops the arc when the adjacent segments are too short to hold it', () => {
		const d = roundedPath(
			[
				[0, 0],
				[1, 0],
				[1, 1],
			],
			8,
		);
		expect(d).not.toContain('Q');
	});
});

describe('labelPoint', () => {
	const route: DiagramPoint[] = [
		[0, 0],
		[50, 0],
		[50, 100],
		[100, 100],
	];

	it('honours an authored anchor verbatim', () => {
		expect(labelPoint(edge({ labelAt: [7, 9] }), route)).toEqual([7, 9]);
	});

	it('lifts a two-point route’s label clear of the stroke', () => {
		expect(
			labelPoint(edge(), [
				[0, 40],
				[100, 40],
			]),
		).toEqual([50, 30]);
	});

	it('clamps a labelSegment past the last segment onto the last one', () => {
		expect(labelPoint(edge({ labelSegment: 99 }), route)).toEqual(
			labelPoint(edge({ labelSegment: route.length - 2 }), route),
		);
	});

	it('clamps a negative labelSegment onto the first one', () => {
		expect(labelPoint(edge({ labelSegment: -5 }), route)).toEqual(
			labelPoint(edge({ labelSegment: 0 }), route),
		);
	});

	it('offsets by the authored dx and dy', () => {
		const plain = labelPoint(edge(), route);
		const nudged = labelPoint(edge({ labelDx: 4, labelDy: 6 }), route);
		expect(nudged).toEqual([
			(plain[0] as number) + 4,
			(plain[1] as number) + 6,
		]);
	});
});

describe('default sides', () => {
	it.each([
		{ from: rect(0, 0), fromSide: 'right', to: rect(400, 0), toSide: 'left' },
		{ from: rect(400, 0), fromSide: 'left', to: rect(0, 0), toSide: 'right' },
		{ from: rect(0, 0), fromSide: 'bottom', to: rect(0, 400), toSide: 'top' },
		{ from: rect(0, 400), fromSide: 'top', to: rect(0, 0), toSide: 'bottom' },
	])('leaves through $fromSide and arrives through $toSide', (testCase) => {
		expect(defaultFromSide(testCase.from, testCase.to)).toBe(testCase.fromSide);
		expect(defaultToSide(testCase.from, testCase.to)).toBe(testCase.toSide);
	});

	it('prefers the authored side over the inferred one', () => {
		expect(chosenSide('top', 'right')).toBe('top');
		expect(chosenSide(undefined, 'right')).toBe('right');
	});

	it('classifies the two horizontal borders as vertical sides', () => {
		expect(isVerticalSide('top')).toBe(true);
		expect(isVerticalSide('bottom')).toBe(true);
		expect(isVerticalSide('left')).toBe(false);
		expect(isVerticalSide('right')).toBe(false);
	});
});

describe('routeHonorsEndpointSides', () => {
	it('accepts a route leaving right and arriving left', () => {
		expect(
			routeHonorsEndpointSides(
				[
					[100, 50],
					[300, 50],
				],
				'right',
				'left',
			),
		).toBe(true);
	});

	it('rejects a route leaving back into its own box', () => {
		expect(
			routeHonorsEndpointSides(
				[
					[100, 50],
					[40, 50],
				],
				'right',
				'left',
			),
		).toBe(false);
	});
});
