/** A half-open UTF-16 span of the original haystack that the needle matched. */
export interface MatchRange {
	end: number;
	start: number;
}

/** Which matching rule produced a result; higher tiers always sort first. */
export const FUZZY_TIER = {
	exact: 4,
	none: 0,
	prefix: 3,
	subsequence: 1,
	substring: 2,
} as const;

/** A fuzzy match: its tier, its within-tier score, and what it matched. */
export interface FuzzyMatch {
	ranges: readonly MatchRange[];
	/** Higher wins within a tier; 0 means no match. */
	score: number;
	tier: number;
}

const NO_MATCH: FuzzyMatch = { ranges: [], score: 0, tier: FUZZY_TIER.none };
const EMPTY_NEEDLE_MATCH: FuzzyMatch = {
	ranges: [],
	score: 1,
	tier: FUZZY_TIER.none,
};

const TRAILING_COMBINING = /^\p{M}$/u;
const VARIATION_SELECTOR = '\uFE0F';
const ZERO_WIDTH_JOINER = '\u200D';

/**
 * Lowercases a string for matching without changing its length, so every index
 * into the folded string is also an index into the original.
 *
 * `U+0130 İ` is the only code point in Unicode whose lowercase form is longer
 * than itself, and folding it would shift every later index and misplace the
 * highlight. It is left unfolded instead, which costs case-insensitivity for one
 * character and buys index safety everywhere.
 * @param value - Text to fold.
 * @returns The folded text, the same UTF-16 length as `value`.
 */
function foldForMatching(value: string): string {
	let folded = '';
	for (const char of value) {
		const lowered = char.toLowerCase();
		folded += lowered.length === char.length ? lowered : char;
	}
	return folded;
}

/**
 * Walks forward past any combining marks, variation selectors, and joined
 * sequences that belong to the character ending at `end`, so a highlight never
 * splits an accent away from its letter.
 * @param text - The original haystack.
 * @param end - Exclusive end of the range being extended.
 * @returns The extended exclusive end.
 */
function extendOverCombining(text: string, end: number): number {
	let cursor = end;
	while (cursor < text.length) {
		const code = text.codePointAt(cursor);
		if (code === undefined) {
			break;
		}
		const char = String.fromCodePoint(code);
		if (char === VARIATION_SELECTOR || TRAILING_COMBINING.test(char)) {
			cursor += char.length;
			continue;
		}
		const joinedCode =
			char === ZERO_WIDTH_JOINER
				? text.codePointAt(cursor + char.length)
				: undefined;
		if (joinedCode === undefined) {
			break;
		}
		cursor += char.length + String.fromCodePoint(joinedCode).length;
	}
	return cursor;
}

/**
 * Extends each range over its trailing combining marks and merges the ones that
 * then touch or overlap, so the highlight renders as few whole spans.
 * @param text - The original haystack the ranges index into.
 * @param ranges - Ascending, non-overlapping ranges to normalize.
 * @returns Ascending, disjoint ranges safe to slice.
 */
function normalizeRanges(
	text: string,
	ranges: readonly MatchRange[],
): MatchRange[] {
	const merged: MatchRange[] = [];
	for (const range of ranges) {
		const end = extendOverCombining(text, range.end);
		const previous = merged.at(-1);
		if (previous && range.start <= previous.end) {
			merged.pop();
			merged.push({ end: Math.max(previous.end, end), start: previous.start });
			continue;
		}
		merged.push({ end, start: range.start });
	}
	return merged;
}

/**
 * Greedily walks the needle through the haystack, scoring +1 per matched
 * character and +1 more when it directly follows the previous one.
 * @param text - The original haystack, used to normalize the ranges.
 * @param folded - The folded haystack, same length as `text`.
 * @param needle - The folded needle to walk.
 * @returns The subsequence match, or no match when a character is missing.
 */
function matchSubsequence(
	text: string,
	folded: string,
	needle: string,
): FuzzyMatch {
	const ranges: MatchRange[] = [];
	let score = 0;
	let cursor = 0;
	for (const char of needle) {
		const found = folded.indexOf(char, cursor);
		if (found < 0) {
			return NO_MATCH;
		}
		score += 1 + (found === cursor ? 1 : 0);
		ranges.push({ end: found + char.length, start: found });
		// Advance by the character's UTF-16 length, not by 1: `for...of` yields
		// code points while `indexOf` reports code-unit offsets, so an astral
		// character would otherwise leave the cursor inside its surrogate pair.
		cursor = found + char.length;
	}
	return {
		ranges: normalizeRanges(text, ranges),
		score,
		tier: FUZZY_TIER.subsequence,
	};
}

/**
 * Matches `needle` against `haystack` for composer autocomplete (mentions and
 * slash commands), reporting the tier, a within-tier score, and which spans of
 * the original text matched so the menu can highlight them.
 *
 * Tiers, strongest first: exact equality (score 1000), prefix (500), substring
 * (250 - position, so an earlier match wins), then a subsequence walk scoring +1
 * per character and +1 more per consecutive run. An empty needle matches
 * everything with no highlight.
 * @param haystack - Text being searched.
 * @param needle - Query typed by the user.
 * @returns The tier, score, and matched ranges; score 0 means no match.
 */
export function fuzzyMatch(haystack: string, needle: string): FuzzyMatch {
	if (!needle) {
		return EMPTY_NEEDLE_MATCH;
	}
	const folded = foldForMatching(haystack);
	const foldedNeedle = foldForMatching(needle);
	if (folded === foldedNeedle) {
		return {
			ranges: [{ end: haystack.length, start: 0 }],
			score: 1000,
			tier: FUZZY_TIER.exact,
		};
	}
	if (folded.startsWith(foldedNeedle)) {
		return {
			ranges: normalizeRanges(haystack, [
				{ end: foldedNeedle.length, start: 0 },
			]),
			score: 500,
			tier: FUZZY_TIER.prefix,
		};
	}
	const directIndex = folded.indexOf(foldedNeedle);
	if (directIndex >= 0) {
		return {
			ranges: normalizeRanges(haystack, [
				{ end: directIndex + foldedNeedle.length, start: directIndex },
			]),
			score: 250 - directIndex,
			tier: FUZZY_TIER.substring,
		};
	}
	return matchSubsequence(haystack, folded, foldedNeedle);
}

/**
 * Scores a fuzzy match without collecting matched ranges, for callers that only
 * rank and never highlight.
 * @param haystack - Text being searched.
 * @param needle - Query typed by the user.
 * @returns The match score; 0 means no match.
 */
export function fuzzyScore(haystack: string, needle: string): number {
	return fuzzyMatch(haystack, needle).score;
}
