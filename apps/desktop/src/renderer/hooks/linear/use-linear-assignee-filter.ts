import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
	linearConnectionQuery,
	linearMetadataQuery,
} from '@/renderer/api/ensemblr';
import {
	createLinearAssigneeMatcher,
	isLinearAssigneePerson,
	type LinearAssigneeOption,
	listLinearAssigneeOptions,
} from '@/renderer/lib/linear';
import type { LinearIssueWire } from '@/shared/ipc/contracts/linear';

/** What a surface needs to render the assignee facet and apply it. */
export interface LinearAssigneeFilter {
	matches: (issue: Pick<LinearIssueWire, 'assigneeId'>) => boolean;
	/** Null while no Linear account is connected, when the facet has nothing to offer. */
	options: LinearAssigneeOption[] | null;
}

/**
 * Resolves one surface's persisted assignee selection against the connected
 * accounts: the predicate to narrow its issues by, and the people its facet
 * offers. The cached member list is read only while a specific person is
 * selected — it names someone whose issues are no longer loaded, and every
 * other option is named by the issues themselves.
 * @param options - The surface's issues before the assignee narrowing, and its selection
 * @returns The facet's predicate, and its person options or null without Linear
 */
export function useLinearAssigneeFilter({
	issues,
	selection,
}: {
	issues: readonly LinearIssueWire[];
	selection: readonly string[];
}): LinearAssigneeFilter {
	const { data: summary } = useQuery(linearConnectionQuery);
	const accounts = summary?.accounts;
	const available = (accounts?.length ?? 0) > 0;
	const { data: metadata } = useQuery({
		...linearMetadataQuery,
		enabled: available && selection.some(isLinearAssigneePerson),
	});
	const viewerIds = useMemo(
		() => (accounts ?? []).map((account) => account.userId),
		[accounts],
	);
	const users = metadata?.status === 'ok' ? metadata.metadata.users : undefined;

	const matches = useMemo(
		() => createLinearAssigneeMatcher(selection, viewerIds),
		[selection, viewerIds],
	);
	const options = useMemo(
		() =>
			available
				? listLinearAssigneeOptions({ issues, selection, users, viewerIds })
				: null,
		[available, issues, selection, users, viewerIds],
	);

	return useMemo(() => ({ matches, options }), [matches, options]);
}
