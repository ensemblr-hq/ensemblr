import { useMemo } from 'react';

import {
	acceptsContiguousMatch,
	closedChatRank,
	rankConciergeReferences,
	type ScoredConciergeReference,
} from '@/renderer/lib/concierge';
import type { ConciergeReferenceMatch } from '@/renderer/types/workbench';
import type { ConciergeReference } from '@/shared/concierge-references';

/**
 * How many chat rows the `@` menu offers above the files.
 *
 * Small on purpose: the chats sit ahead of a file list that is ranked eighty
 * deep and hierarchically, so the cap is what a file pick has to scroll past.
 * Five covers the conversations a workspace has running without ever pushing the
 * first file below the fold.
 */
export const CHAT_REFERENCE_MATCH_LIMIT = 5;

/**
 * Ranks a workspace's chats against the `@` query.
 *
 * Ties keep the order they arrived in — open tabs in tab-strip order, then
 * closed ones newest first — rather than falling back to the label. An empty
 * query scores every chat alike, and sorting those alphabetically would offer
 * the workspace's conversations in an order nothing on screen is arranged in.
 *
 * A typed query has to hit a contiguous run of the label, which the flat
 * Concierge menu does not require: these rows are pinned above the files rather
 * than ranked against them, so a subsequence match would take the highlight from
 * an exact file match sitting below it.
 * @param references - This workspace's chats.
 * @param query - The text after the `@`.
 * @param limit - How many rows to keep.
 * @returns The ranked, capped rows.
 */
export function getChatReferenceMatches(
	references: readonly ConciergeReference[],
	query: string,
	limit = CHAT_REFERENCE_MATCH_LIMIT,
): ConciergeReferenceMatch[] {
	return rankConciergeReferences(references, query, {
		accepts: acceptsContiguousMatch,
		compare: compareScoredChats,
		limit,
	});
}

/** Ranks by score, then sinks a closed chat below an open one. */
function compareScoredChats(
	left: ScoredConciergeReference,
	right: ScoredConciergeReference,
): number {
	return left.score === right.score
		? closedChatRank(left) - closedChatRank(right)
		: right.score - left.score;
}

/** Memoized hook for the composer's `@` chat rows. */
export function useChatReferenceMatches(
	references: readonly ConciergeReference[],
	query: string,
	limit = CHAT_REFERENCE_MATCH_LIMIT,
): ConciergeReferenceMatch[] {
	return useMemo(
		() => getChatReferenceMatches(references, query, limit),
		[limit, query, references],
	);
}
