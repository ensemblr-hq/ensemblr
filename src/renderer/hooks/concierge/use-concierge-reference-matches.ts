import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
	allChatTabsQuery,
	conciergeArtifactsQuery,
} from '@/renderer/api/ensemblr';
import { useWorkbenchLayoutRouteModelOptional } from '@/renderer/components/workbench-shell/shell-contexts';
import { buildConciergeReferences } from '@/renderer/lib/concierge';
import { fuzzyMatch } from '@/renderer/lib/workbench/fuzzy-score';
import type { ConciergeReferenceMatch } from '@/renderer/types/workbench';
import type { ConciergeReference } from '@/shared/concierge-references';

/** How many rows the menu offers, which is well past what a popover shows at once. */
const REFERENCE_MATCH_LIMIT = 40;

/** Order the kinds appear in at equal score, and how a tie between them breaks. */
const KIND_ORDER: Record<ConciergeReference['kind'], number> = {
	artifact: 1,
	chat: 2,
	project: 3,
	workspace: 0,
};

/** One candidate paired with its score and the spans of its label that matched. */
interface ScoredReference {
	match: ConciergeReferenceMatch;
	score: number;
}

/**
 * The Concierge's `@` catalogue: every project, workspace, and chat the app
 * holds, plus the artifacts the Concierge has written, ranked against what the
 * user has typed.
 *
 * Workspaces lead an unfiltered menu because they are what the Concierge is
 * usually asked to act on, and an open chat outranks a closed one at equal score
 * — a closed chat is history, and offering it first would bury the conversation
 * the user is actually in.
 * @param query - The text after the `@`, empty when the token was just opened.
 * @param enabled - False while no `@` token is under the caret, which keeps the
 *   app-wide tab listing unfetched until the menu is actually wanted.
 * @returns The ranked rows.
 */
export function useConciergeReferenceMatches(
	query: string,
	enabled: boolean,
): readonly ConciergeReferenceMatch[] {
	const layoutModel = useWorkbenchLayoutRouteModelOptional();
	const projects = layoutModel?.displayProjects;
	const { data: chatTabs } = useQuery({ ...allChatTabsQuery, enabled });
	const { data: artifacts } = useQuery({ ...conciergeArtifactsQuery, enabled });

	const references = useMemo(
		() =>
			buildConciergeReferences({
				artifacts: artifacts?.artifacts ?? [],
				chatTabs: chatTabs ?? { closed: [], open: [] },
				projects: projects ?? [],
			}),
		[artifacts, chatTabs, projects],
	);

	return useMemo(
		() => (enabled ? rankReferences(references, query) : []),
		[enabled, query, references],
	);
}

/**
 * Scores every candidate against the query and returns the best rows.
 * @param references - The catalogue.
 * @param query - The text after the `@`.
 * @returns The ranked, capped rows.
 */
function rankReferences(
	references: readonly ConciergeReference[],
	query: string,
): readonly ConciergeReferenceMatch[] {
	const scored: ScoredReference[] = [];
	for (const reference of references) {
		const matched = fuzzyMatch(reference.label, query);
		if (matched.score > 0) {
			scored.push({
				match: { labelRanges: matched.ranges, reference },
				score: matched.score,
			});
		}
	}
	return scored
		.sort(compareScored)
		.slice(0, REFERENCE_MATCH_LIMIT)
		.map((entry) => entry.match);
}

/** Ranks by score, then by kind, then by label so the order never wobbles. */
function compareScored(left: ScoredReference, right: ScoredReference): number {
	if (left.score !== right.score) {
		return right.score - left.score;
	}
	const kinds =
		KIND_ORDER[left.match.reference.kind] -
		KIND_ORDER[right.match.reference.kind];
	if (kinds !== 0) {
		return kinds;
	}
	const liveness = closedRank(left) - closedRank(right);
	return liveness === 0
		? left.match.reference.label.localeCompare(right.match.reference.label)
		: liveness;
}

/** Sinks a closed chat below an open one, leaving every other kind level. */
function closedRank(entry: ScoredReference): number {
	const { reference } = entry.match;
	return reference.kind === 'chat' && reference.state === 'closed' ? 1 : 0;
}
