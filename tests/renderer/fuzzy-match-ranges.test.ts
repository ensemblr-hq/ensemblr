import { describe, expect, test } from 'vitest';

import {
	FUZZY_TIER,
	fuzzyMatch,
	fuzzyScore,
	type MatchRange,
} from '../../src/renderer/lib/workbench/fuzzy-score';

/** Renders the matched spans as the substrings the menu would highlight. */
function matchedText(
	haystack: string,
	ranges: readonly MatchRange[],
): string[] {
	return ranges.map((range) => haystack.slice(range.start, range.end));
}

describe('fuzzyMatch tiers', () => {
	test('an exact match covers the whole string', () => {
		const result = fuzzyMatch('code-review', 'CODE-REVIEW');
		expect(result.score).toBe(1000);
		expect(result.tier).toBe(FUZZY_TIER.exact);
		expect(matchedText('code-review', result.ranges)).toEqual(['code-review']);
	});

	test('a prefix match covers just the typed prefix', () => {
		const result = fuzzyMatch('code-review', 'code-');
		expect(result.score).toBe(500);
		expect(result.tier).toBe(FUZZY_TIER.prefix);
		expect(matchedText('code-review', result.ranges)).toEqual(['code-']);
	});

	test('a substring match covers the run and scores by position', () => {
		const result = fuzzyMatch('run-code-review', 'code');
		expect(result.score).toBe(250 - 4);
		expect(result.tier).toBe(FUZZY_TIER.substring);
		expect(matchedText('run-code-review', result.ranges)).toEqual(['code']);
	});

	test('a subsequence match covers each matched character', () => {
		const result = fuzzyMatch('context-mode', 'code');
		expect(result.tier).toBe(FUZZY_TIER.subsequence);
		expect(matchedText('context-mode', result.ranges).join('')).toBe('code');
	});

	test('an empty needle matches everything with nothing highlighted', () => {
		const result = fuzzyMatch('code-review', '');
		expect(result.score).toBe(1);
		expect(result.ranges).toEqual([]);
	});

	test('a missing character is no match', () => {
		const result = fuzzyMatch('code-review', 'zzz');
		expect(result.score).toBe(0);
		expect(result.tier).toBe(FUZZY_TIER.none);
		expect(result.ranges).toEqual([]);
	});
});

describe('fuzzyMatch range safety', () => {
	// `U+0130 İ` is the only code point whose lowercase form is longer than
	// itself; folding it would shift every later index by one.
	test('a length-changing uppercase character does not shift the highlight', () => {
		const haystack = 'İnspect-code';
		const result = fuzzyMatch(haystack, 'code');
		expect(matchedText(haystack, result.ranges)).toEqual(['code']);
	});

	test('an astral character is highlighted whole, never half a surrogate pair', () => {
		const haystack = 'a\u{1F600}b';
		const result = fuzzyMatch(haystack, '\u{1F600}b');
		const matched = matchedText(haystack, result.ranges);
		expect(matched.join('')).toBe('\u{1F600}b');
		for (const segment of matched) {
			expect(segment.isWellFormed()).toBe(true);
		}
	});

	test('a trailing combining mark stays with the letter it belongs to', () => {
		const haystack = 'café-deploy';
		const result = fuzzyMatch(haystack, 'cafe');
		expect(matchedText(haystack, result.ranges)).toEqual(['café']);
	});

	test('ranges are ascending and disjoint', () => {
		const result = fuzzyMatch('context-mode:ctx-purge', 'code');
		let previousEnd = -1;
		for (const range of result.ranges) {
			expect(range.start).toBeGreaterThanOrEqual(previousEnd);
			expect(range.end).toBeGreaterThan(range.start);
			previousEnd = range.end;
		}
	});
});

describe('fuzzyScore', () => {
	test('reports the same numbers the ranking has always used', () => {
		expect(fuzzyScore('code-review', '')).toBe(1);
		expect(fuzzyScore('code-review', 'code-review')).toBe(1000);
		expect(fuzzyScore('code-review', 'code')).toBe(500);
		expect(fuzzyScore('run-code', 'code')).toBe(250 - 4);
		expect(fuzzyScore('code-review', 'zzz')).toBe(0);
	});
});
