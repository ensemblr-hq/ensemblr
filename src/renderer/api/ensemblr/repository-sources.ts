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
// Issues back a whole board, not a picker opened on demand, and main already
// serves them from SQLite between runs. Holding them longer keeps a tab switch
// back to the dashboard off the `gh` path entirely.
const ISSUES_STALE_MS = 5 * 60_000;

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

/**
 * Query options for the repository's open GitHub issues. Main answers these from
 * a SQLite cache while it is fresh, so this query is what the dashboard board
 * paints from at app start rather than a cold `gh issue list` per repository.
 * `unassignedOnly` is the board's backlog variant — it is a different list from
 * the pickers', narrowed by `gh` rather than after the fact, so it carries its
 * own query key and its own cache row.
 */
export function repositoryIssuesQuery(
	repositoryId: string,
	unassignedOnly = false,
) {
	return queryOptions({
		queryFn: (): Promise<ListRepositoryIssuesResult> =>
			profileElectronIpcCall(
				{ channel: 'ensemblr:list-repository-issues', usesDatabase: true },
				() =>
					getEnsemblrApi().listRepositoryIssues({
						repositoryId,
						unassignedOnly,
					}),
			),
		queryKey: ensemblrQueryKeys.repositoryIssues(repositoryId, unassignedOnly),
		staleTime: ISSUES_STALE_MS,
	});
}

/**
 * Warms the dashboard board's issue lists — one per repository plus the shared
 * Linear list. Called as the board mounts so the `gh` calls that miss the cache
 * overlap the board's first paint instead of following it.
 * @param queryClient - The app's query client.
 * @param repositoryIds - Every repository whose issues the board shows.
 */
export function prefetchBoardIssues(
	queryClient: QueryClient,
	repositoryIds: readonly string[],
): void {
	void queryClient.prefetchQuery(linearIssuesQuery({}));
	for (const repositoryId of repositoryIds) {
		if (repositoryId) {
			void queryClient.prefetchQuery(repositoryIssuesQuery(repositoryId, true));
		}
	}
}

/**
 * Re-lists every repository's board issues from `gh`, bypassing the SQLite cache.
 * Backs the board toolbar's refresh, which is the only way out of a stale list
 * when `gh` has been failing and the cache has been standing in for it.
 * @param queryClient - The app's query client.
 * @param repositoryIds - Every repository whose issues the board shows.
 * @returns Resolves once every repository has settled, successfully or not.
 */
export async function refreshBoardIssues(
	queryClient: QueryClient,
	repositoryIds: readonly string[],
): Promise<void> {
	// `allSettled`, not `all`: a rejected `fetchQuery` already lands as error
	// state on its own query, and racing the rest to a rejection would drop the
	// caller's pending flag while the other repositories are still listing.
	await Promise.allSettled([
		queryClient.fetchQuery({ ...linearIssuesQuery({}), staleTime: 0 }),
		...repositoryIds.filter(Boolean).map((repositoryId) =>
			queryClient.fetchQuery({
				...repositoryIssuesQuery(repositoryId, true),
				queryFn: (): Promise<ListRepositoryIssuesResult> =>
					profileElectronIpcCall(
						{ channel: 'ensemblr:list-repository-issues', usesDatabase: true },
						() =>
							getEnsemblrApi().listRepositoryIssues({
								refresh: true,
								repositoryId,
								unassignedOnly: true,
							}),
					),
				// `fetchQuery` honours `staleTime` and resolves straight from cache
				// when the row is fresh, so the query options spread above would skip
				// the refreshing `queryFn` for the whole `ISSUES_STALE_MS` window —
				// leaving the button that exists to escape a stale list a no-op.
				staleTime: 0,
			}),
		),
	]);
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
