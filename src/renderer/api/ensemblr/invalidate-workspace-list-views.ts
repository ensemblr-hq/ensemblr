import type { QueryClient } from '@tanstack/react-query';

import { ensemblrQueryKeys } from './query-keys';

/**
 * Invalidates the cross-cutting workspace list views that every archive,
 * unarchive, or delete mutation must refresh: the sidebar navigation snapshot,
 * the global History feed, and the create-from-source picker's branch list.
 * Centralised so adding another list view is a one-line change here instead of
 * a hunt across every mutation site (and so no site forgets one — the bug the
 * History feed already had to fix once).
 */
export function invalidateWorkspaceListViews(
	queryClient: QueryClient,
): Promise<unknown> {
	return Promise.all([
		queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.repositoryWorkspaceNavigation(),
		}),
		queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.workspaceHistory(),
		}),
		// The picker's branch list embeds workspace lifecycle state (a branch
		// backing an active workspace shows Open/Duplicate, else Use branch), so
		// archiving a workspace must flip its branch row back to "Use branch"
		// immediately. Costs nothing while the picker is closed — an
		// observer-less query is just marked stale until the next open.
		queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.repositoryBranchesAll(),
		}),
	]);
}
