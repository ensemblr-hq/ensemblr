import {
	FUZZY_TIER,
	type FuzzyMatch,
	fuzzyMatch,
} from '@/renderer/lib/workbench/fuzzy-score';
import type { ConciergeReferenceMatch } from '@/renderer/types/workbench';
import type { ConciergeReference } from '@/shared/concierge-references';

/** One candidate paired with its score and the spans of its label that matched. */
export interface ScoredConciergeReference {
	match: ConciergeReferenceMatch;
	score: number;
}

/**
 * Sinks a closed chat below an open one, leaving every other kind level. A
 * closed chat is history, so offering it above the conversation the user is
 * actually in reads as the menu preferring the wrong one.
 * @param entry - The scored row being ordered.
 * @returns 1 for a closed chat, 0 for everything else.
 */
export function closedChatRank(entry: ScoredConciergeReference): number {
	const { reference } = entry.match;
	return reference.kind === 'chat' && reference.state === 'closed' ? 1 : 0;
}

/**
 * Accepts a row only where a typed query matched a contiguous run of its label.
 *
 * `fuzzyMatch` falls back to a subsequence walk, which finds `src` inside
 * `Ship the release candidate` and scores it 4 against the 1000 an exact match
 * earns. A menu that ranks these rows against each other absorbs that
 * difference; one that pins them above another list does not, so the weak match
 * would take the highlight from the exact one below it.
 *
 * An empty query is exempt, and has to be: it reports `FUZZY_TIER.none` for
 * every row, so gating on tier would empty the menu at exactly the moment a bare
 * `@` is what shows the user there are chats to point at.
 * @param match - What the fuzzy matcher reported for this row.
 * @param query - The text after the `@`, empty when the token was just opened.
 * @returns True when the row is strong enough to lead a menu.
 */
export function acceptsContiguousMatch(
	match: FuzzyMatch,
	query: string,
): boolean {
	return query.length === 0 || match.tier >= FUZZY_TIER.substring;
}

/** Keeps every row the fuzzy matcher scored at all. */
function acceptsAnyMatch(): boolean {
	return true;
}

/**
 * Scores references against an `@` query and returns the best rows, highlight
 * spans included.
 *
 * The ordering and the cap are the caller's, because the two menus reading this
 * want different ones: the Concierge ranks one flat catalogue across every kind,
 * while the workbench offers a short chat list pinned above its files. What they
 * share is the scoring walk and the shape it produces, and a second copy of that
 * is a chip that highlights differently depending on which menu minted it.
 * @param references - The candidates to rank.
 * @param query - The text after the `@`, empty when the token was just opened.
 * @param options - The acceptance gate, the ordering, and how many rows to keep.
 * @returns The ranked, capped rows.
 */
export function rankConciergeReferences(
	references: readonly ConciergeReference[],
	query: string,
	{
		accepts = acceptsAnyMatch,
		compare,
		limit,
	}: {
		accepts?: (match: FuzzyMatch, query: string) => boolean;
		compare: (
			left: ScoredConciergeReference,
			right: ScoredConciergeReference,
		) => number;
		limit: number;
	},
): ConciergeReferenceMatch[] {
	const scored: ScoredConciergeReference[] = [];
	for (const reference of references) {
		const matched = fuzzyMatch(reference.label, query);
		if (matched.score > 0 && accepts(matched, query)) {
			scored.push({
				match: { labelRanges: matched.ranges, reference },
				score: matched.score,
			});
		}
	}
	return scored
		.sort(compare)
		.slice(0, limit)
		.map((entry) => entry.match);
}
