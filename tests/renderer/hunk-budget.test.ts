/**
 * `react-diff-view` lays out one table row per change line with no windowing, so
 * the row budget is the only thing between a committed bundle's diff and a
 * six-figure DOM node count. These pin the trim's rules: whole hunks, except a
 * first hunk too long to fit, which is cut to the budget rather than mounted
 * whole; and never an empty diff.
 */

import type { HunkData } from 'react-diff-view';
import { describe, expect, test } from 'vitest';

import {
	boundHunksToRowBudget,
	countPatchesWithinRowBudget,
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

	test('cuts a first hunk that alone exceeds the budget down to the budget', () => {
		const hunks = [hunkOf(5_000, 'a'), hunkOf(10, 'b')];
		const bounded = boundHunksToRowBudget(hunks, 100);
		expect(bounded.hunks).toHaveLength(1);
		expect(bounded.hunks[0]?.changes).toHaveLength(100);
		expect(bounded.hiddenHunks).toBe(1);
		expect(bounded.hiddenRows).toBe(4_910);
	});

	test('cuts a lone oversized hunk and reports its rows as hidden', () => {
		const bounded = boundHunksToRowBudget([hunkOf(300, 'a')], 100);
		expect(bounded.hunks[0]?.changes).toHaveLength(100);
		expect(bounded.hiddenHunks).toBe(0);
		expect(bounded.hiddenRows).toBe(200);
	});

	test('keeps the cut hunk identifiable and leaves the original whole', () => {
		const hunks = [hunkOf(300, 'a')];
		const bounded = boundHunksToRowBudget(hunks, 100);
		expect(bounded.hunks[0]?.content).toBe('a');
		expect(bounded.hunks[0]).not.toBe(hunks[0]);
		expect(hunks[0]?.changes).toHaveLength(300);
	});

	test('keeps a first hunk that fits exactly, uncut', () => {
		const hunks = [hunkOf(100, 'a')];
		const bounded = boundHunksToRowBudget(hunks, 100);
		expect(bounded.hunks).toBe(hunks);
		expect(bounded.hiddenRows).toBe(0);
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

describe('countPatchesWithinRowBudget', () => {
	/**
	 * Builds a patch of `lines` newline-terminated lines.
	 * @param lines - How many lines the patch carries
	 * @returns The patch text
	 */
	function patchOfLines(lines: number): string {
		return 'x\n'.repeat(lines);
	}

	test('counts every patch when they all fit', () => {
		const patches = [patchOfLines(10), patchOfLines(20)];
		expect(countPatchesWithinRowBudget(patches, 100)).toBe(2);
	});

	test('stops at the first patch that would overrun the budget', () => {
		const patches = [patchOfLines(40), patchOfLines(40), patchOfLines(40)];
		expect(countPatchesWithinRowBudget(patches, 100)).toBe(2);
	});

	test('does not skip past an overrun to fit a later, smaller patch', () => {
		const patches = [patchOfLines(60), patchOfLines(60), patchOfLines(1)];
		expect(countPatchesWithinRowBudget(patches, 100)).toBe(1);
	});

	test('keeps the first patch even when it alone exceeds the budget', () => {
		const patches = [patchOfLines(500), patchOfLines(1)];
		expect(countPatchesWithinRowBudget(patches, 100)).toBe(1);
	});

	test('charges no patch more than the per-file row budget', () => {
		const patches = [
			patchOfLines(MAX_RENDERED_DIFF_ROWS * 5),
			patchOfLines(10),
		];
		expect(
			countPatchesWithinRowBudget(patches, MAX_RENDERED_DIFF_ROWS + 10),
		).toBe(2);
	});

	test('counts a last line that has no trailing newline', () => {
		expect(countPatchesWithinRowBudget(['a\nb', 'c\nd'], 3)).toBe(1);
		expect(countPatchesWithinRowBudget(['a\nb', 'c\nd'], 4)).toBe(2);
	});

	test('returns zero when there is nothing to lay out', () => {
		expect(countPatchesWithinRowBudget([], 100)).toBe(0);
	});
});
