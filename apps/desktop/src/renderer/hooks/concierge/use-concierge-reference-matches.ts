import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
	allChatTabsQuery,
	conciergeArtifactsQuery,
} from '@/renderer/api/ensemblr';
import { useWorkbenchLayoutRouteModelOptional } from '@/renderer/components/workbench-shell/shell-contexts';
import {
	buildConciergeReferences,
	closedChatRank,
	rankConciergeReferences,
	type ScoredConciergeReference,
} from '@/renderer/lib/concierge';
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
		() =>
			enabled
				? rankConciergeReferences(references, query, {
						compare: compareScored,
						limit: REFERENCE_MATCH_LIMIT,
					})
				: [],
		[enabled, query, references],
	);
}

/** Ranks by score, then by kind, then by label so the order never wobbles. */
function compareScored(
	left: ScoredConciergeReference,
	right: ScoredConciergeReference,
): number {
	if (left.score !== right.score) {
		return right.score - left.score;
	}
	const kinds =
		KIND_ORDER[left.match.reference.kind] -
		KIND_ORDER[right.match.reference.kind];
	if (kinds !== 0) {
		return kinds;
	}
	const liveness = closedChatRank(left) - closedChatRank(right);
	return liveness === 0
		? left.match.reference.label.localeCompare(right.match.reference.label)
		: liveness;
}
