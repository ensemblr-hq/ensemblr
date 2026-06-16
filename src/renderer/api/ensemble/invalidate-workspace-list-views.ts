import type { QueryClient } from '@tanstack/react-query';

import { ensembleQueryKeys } from './query-keys';

/**
 * Invalidates the two cross-cutting workspace list views that every archive,
 * unarchive, or delete mutation must refresh: the sidebar navigation snapshot
 * and the global History feed. Centralised so adding a third list view is a
 * one-line change here instead of a hunt across every mutation site (and so no
 * site forgets one — the bug the History feed already had to fix once).
 */
export function invalidateWorkspaceListViews(
	queryClient: QueryClient,
): Promise<unknown> {
	return Promise.all([
		queryClient.invalidateQueries({
			queryKey: ensembleQueryKeys.repositoryWorkspaceNavigation(),
		}),
		queryClient.invalidateQueries({
			queryKey: ensembleQueryKeys.workspaceHistory(),
		}),
	]);
}
