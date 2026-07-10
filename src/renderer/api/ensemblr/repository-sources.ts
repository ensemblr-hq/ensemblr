import { type QueryClient, queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	ListRepositoryBranchesResult,
	ListRepositoryIssuesResult,
	ListRepositoryPullRequestsResult,
} from '@/shared/ipc/contracts/workspace-sources';

import { linearIssuesQuery } from './linear';
import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

// Kept generous so reopening the picker (or flipping tabs) reuses cached rows
// instead of flashing a loading state; a background refetch still freshens them.
const SOURCES_STALE_MS = 60_000;
// Remote branches change outside the app (teammates push, branches merge or get
// deleted on GitHub). While the picker is open, poll so new/removed branches —
// and the Open/Duplicate ↔ Use-branch state — refresh without reopening the
// dialog. Only fires while the query has an active observer (the dialog is open).
const BRANCHES_REFETCH_MS = 15_000;

/** Query options for the repository's remote git branches (via `gh`). */
export function repositoryBranchesQuery(repositoryId: string) {
	return queryOptions({
		queryFn: (): Promise<ListRepositoryBranchesResult> =>
			profileElectronIpcCall(
				{ channel: 'ensemblr:list-repository-branches', usesDatabase: true },
				() => getEnsemblrApi().listRepositoryBranches({ repositoryId }),
			),
		queryKey: ensemblrQueryKeys.repositoryBranches(repositoryId),
		refetchInterval: BRANCHES_REFETCH_MS,
		staleTime: SOURCES_STALE_MS,
	});
}

/** Query options for the repository's open pull requests (via `gh`). */
export function repositoryPullRequestsQuery(repositoryId: string) {
	return queryOptions({
		queryFn: (): Promise<ListRepositoryPullRequestsResult> =>
			profileElectronIpcCall(
				{
					channel: 'ensemblr:list-repository-pull-requests',
					usesDatabase: true,
				},
				() => getEnsemblrApi().listRepositoryPullRequests({ repositoryId }),
			),
		queryKey: ensemblrQueryKeys.repositoryPullRequests(repositoryId),
		staleTime: SOURCES_STALE_MS,
	});
}

/** Query options for the repository's open GitHub issues (via `gh`). */
export function repositoryIssuesQuery(repositoryId: string) {
	return queryOptions({
		queryFn: (): Promise<ListRepositoryIssuesResult> =>
			profileElectronIpcCall(
				{ channel: 'ensemblr:list-repository-issues', usesDatabase: true },
				() => getEnsemblrApi().listRepositoryIssues({ repositoryId }),
			),
		queryKey: ensemblrQueryKeys.repositoryIssues(repositoryId),
		staleTime: SOURCES_STALE_MS,
	});
}

/**
 * Warms every create-from-source list for a repository so the picker opens with
 * data already in cache. Called on hover/focus of the create-from trigger;
 * `prefetchQuery` is a no-op when a fresh cache row already exists. The global
 * Linear list is repo-independent but warmed here too since the Issues tab needs
 * it. All four run in parallel and failures are swallowed by react-query.
 */
export function prefetchWorkspaceSources(
	queryClient: QueryClient,
	repositoryId: string,
): void {
	if (!repositoryId) {
		return;
	}
	void queryClient.prefetchQuery(repositoryBranchesQuery(repositoryId));
	void queryClient.prefetchQuery(repositoryPullRequestsQuery(repositoryId));
	void queryClient.prefetchQuery(repositoryIssuesQuery(repositoryId));
	void queryClient.prefetchQuery(linearIssuesQuery({}));
}
