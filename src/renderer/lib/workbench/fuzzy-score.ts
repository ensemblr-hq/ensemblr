/**
 * Scores how well `haystack` matches `needle` for composer autocomplete
 * (mentions and slash commands). Returns 0 when no fuzzy subsequence match
 * exists. Higher score wins.
 *
 * Tiers:
 *   - empty needle → 1 (everything matches, sort stable)
 *   - exact equality → 1000
 *   - prefix match → 500
 *   - substring match → 250 - position (earlier wins)
 *   - subsequence match → cumulative score, +1 per char, +1 bonus for consecutive
 */
export function fuzzyScore(haystack: string, needle: string): number {
	if (!needle) {
		return 1;
	}
	const lowerHaystack = haystack.toLowerCase();
	const lowerNeedle = needle.toLowerCase();
	if (lowerHaystack === lowerNeedle) {
		return 1000;
	}
	if (lowerHaystack.startsWith(lowerNeedle)) {
		return 500;
	}
	const directIndex = lowerHaystack.indexOf(lowerNeedle);
	if (directIndex >= 0) {
		return 250 - directIndex;
	}
	let score = 0;
	let cursor = 0;
	for (const char of lowerNeedle) {
		const found = lowerHaystack.indexOf(char, cursor);
		if (found < 0) {
			return 0;
		}
		score += 1 + (found === cursor ? 1 : 0);
		cursor = found + 1;
	}
	return score;
}
