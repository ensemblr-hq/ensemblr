import { describe, expect, it } from 'vitest';

import {
	availableNodeTextWidth,
	fittedNodeFontSize,
	minimumNodeTextWidth,
	textUnits,
} from '../../src/renderer/lib/architecture-diagram/text-fit';

describe('textUnits', () => {
	it.each([
		{ expected: 0, text: '' },
		{ expected: 0, text: undefined },
		{ expected: 7, text: 'gateway' },
		{ expected: 22, text: 'src/renderer/component' },
		{ expected: 12, text: '認証サービス' },
		{ expected: 7, text: 'api認証' },
		{ expected: 2, text: '🚀' },
		{ expected: 4, text: 'ab🚀' },
	])('measures $text as $expected units', ({ expected, text }) => {
		expect(textUnits(text)).toBe(expected);
	});

	it('measures a Greek label one unit per letter', () => {
		expect(textUnits('Υπηρεσία')).toBe('Υπηρεσία'.length);
	});

	it('takes its width from the variation selector, not the base character', () => {
		expect(textUnits('✔️')).toBe(2);
		expect(textUnits('✔︎')).toBe(1);
	});

	it('measures a fullwidth label at twice its code-point count', () => {
		expect(textUnits('データベース')).toBe(textUnits('databaselayer') - 1);
	});
});

describe('availableNodeTextWidth', () => {
	it('subtracts the box padding', () => {
		expect(availableNodeTextWidth(168)).toBe(160);
	});

	it('goes non-positive on a box narrower than its own padding', () => {
		expect(availableNodeTextWidth(4)).toBeLessThanOrEqual(0);
	});
});

describe('fittedNodeFontSize', () => {
	it('keeps the preferred size when the text already fits', () => {
		expect(fittedNodeFontSize('api', 168, 13, 6)).toBe(13);
	});

	it('shrinks toward the floor as the text grows', () => {
		const short = fittedNodeFontSize('api', 120, 13, 6);
		const long = fittedNodeFontSize('src/renderer/components', 120, 13, 6);
		expect(long).toBeLessThan(short);
		expect(long).toBeGreaterThanOrEqual(6);
	});

	it('never falls below the legible minimum', () => {
		expect(fittedNodeFontSize('a'.repeat(400), 120, 13, 6)).toBe(6);
	});

	// A node narrower than the padding is what makes this worth pinning: an
	// unclamped divisor would hand SVG a NaN font-size, which it drops silently.
	it.each([
		{ label: 'a box narrower than its padding', width: 4 },
		{ label: 'a zero-width box', width: 0 },
		{ label: 'a negative width', width: -40 },
	])('returns a finite size for $label', ({ width }) => {
		const size = fittedNodeFontSize('gateway', width, 13, 6);
		expect(Number.isFinite(size)).toBe(true);
		expect(size).toBe(6);
	});

	it('returns a finite size for an empty label', () => {
		expect(Number.isFinite(fittedNodeFontSize('', 168, 13, 6))).toBe(true);
	});

	it('shrinks a CJK label its ASCII counterpart would leave at full size', () => {
		expect(fittedNodeFontSize('データベース', 80, 13, 1)).toBeLessThan(
			fittedNodeFontSize('database', 80, 13, 1),
		);
	});
});

describe('minimumNodeTextWidth', () => {
	it('scales with the advance width the text needs at the floor size', () => {
		expect(minimumNodeTextWidth('api', 6)).toBeCloseTo(3 * 6 * 0.6, 5);
	});

	it('is zero for an empty label', () => {
		expect(minimumNodeTextWidth('', 6)).toBe(0);
	});

	it('reports a label that shrink-to-fit cannot rescue', () => {
		const width = 40;
		expect(minimumNodeTextWidth('src/renderer/components', 6)).toBeGreaterThan(
			availableNodeTextWidth(width),
		);
	});
});
