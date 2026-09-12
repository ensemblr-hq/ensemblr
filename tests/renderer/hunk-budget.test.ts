/**
 * `react-diff-view` lays out one table row per change line with no windowing, so
 * the row budget is the only thing between a committed bundle's diff and a
 * six-figure DOM node count. These pin the trim's two rules: whole hunks only,
 * and never an empty diff.
 */

import type { HunkData } from 'react-diff-view';
import { describe, expect, test } from 'vitest';

import {
	boundHunksToRowBudget,
	MAX_RENDERED_DIFF_ROWS,
} from '../../src/renderer/components/diff-viewer/hunk-budget';

/**
 * Builds a hunk carrying a given number of change rows; only `changes.length`
 * and `content` matter to the budget.
 * @param rows - How many change rows the hunk carries
 * @param label - Distinguishes one fixture hunk from another
 * @returns A hunk shaped enough for the budget to read
 */
function hunkOf(rows: number, label: string): HunkData {
	return {
		changes: Array.from({ length: rows }, () => ({
			content: label,
			isNormal: true,
			lineNumber: 1,
			newLineNumber: 1,
			oldLineNumber: 1,
			type: 'normal',
		})),
		content: label,
		newLines: rows,
		newStart: 1,
		oldLines: rows,
		oldStart: 1,
	} as unknown as HunkData;
}

describe('boundHunksToRowBudget', () => {
	test('returns the same list identity when everything fits', () => {
		const hunks = [hunkOf(10, 'a'), hunkOf(20, 'b')];
		const bounded = boundHunksToRowBudget(hunks, 100);
		expect(bounded.hunks).toBe(hunks);
		expect(bounded.hiddenHunks).toBe(0);
		expect(bounded.hiddenRows).toBe(0);
	});

	test('keeps whole hunks and reports what it withheld', () => {
		const hunks = [hunkOf(30, 'a'), hunkOf(30, 'b'), hunkOf(40, 'c')];
		const bounded = boundHunksToRowBudget(hunks, 65);
		expect(bounded.hunks).toHaveLength(2);
		expect(bounded.hiddenHunks).toBe(1);
		expect(bounded.hiddenRows).toBe(40);
	});

	test('never trims a hunk in half', () => {
		const hunks = [hunkOf(10, 'a'), hunkOf(100, 'b')];
		const bounded = boundHunksToRowBudget(hunks, 50);
		expect(bounded.hunks).toHaveLength(1);
		expect(bounded.hunks[0]?.changes).toHaveLength(10);
	});

	test('keeps the first hunk even when it alone exceeds the budget', () => {
		const hunks = [hunkOf(5_000, 'a'), hunkOf(10, 'b')];
		const bounded = boundHunksToRowBudget(hunks, 100);
		expect(bounded.hunks).toHaveLength(1);
		expect(bounded.hiddenHunks).toBe(1);
		expect(bounded.hiddenRows).toBe(10);
	});

	test('defaults to the shipped row ceiling', () => {
		const hunks = [hunkOf(MAX_RENDERED_DIFF_ROWS, 'a'), hunkOf(1, 'b')];
		expect(boundHunksToRowBudget(hunks).hiddenHunks).toBe(1);
	});

	test('handles an empty file', () => {
		const bounded = boundHunksToRowBudget([], 100);
		expect(bounded.hunks).toHaveLength(0);
		expect(bounded.hiddenHunks).toBe(0);
	});
});
