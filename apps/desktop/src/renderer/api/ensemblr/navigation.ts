import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type { StampedWorkspacePrPresentation } from '@/shared/github-pr-presentation';
import type { RepositoryWorkspaceNavigationSnapshot } from '@/shared/ipc/contracts/repository-navigation';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

/**
 * Query options for the GitHub accounts a quick-start project can be published
 * under. Organization membership barely moves, so this is cached generously;
 * a failure yields an empty list and the owner picker hides itself.
 */
export const githubOwnerListQuery = queryOptions({
	/** Fetches the publishable GitHub owner list over IPC with call profiling. */
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemblr:github-owner-list', usesDatabase: false },
			() => getEnsemblrApi().githubOwnerList(),
		),
	queryKey: ensemblrQueryKeys.githubOwnerList(),
	// Held well past `staleTime` so moving between the welcome screen and the
	// workbench does not throw the answer away and make the next dialog wait on
	// `gh` again.
	gcTime: 1_800_000,
	staleTime: 300_000,
});

/** Query options for the gh-backed GitHub repository list (8 most recent). */
export const githubRepositoryListQuery = queryOptions({
	/** Fetches the recent GitHub repository list over IPC with call profiling. */
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemblr:github-repository-list', usesDatabase: false },
			() => getEnsemblrApi().githubRepositoryList(),
		),
	queryKey: ensemblrQueryKeys.githubRepositoryList(),
	staleTime: 60_000,
});

/**
 * Query options for the full accessible-repo set, fetched in the background so
 * the clone dialog's search can cover more than the 8 most recent repos.
 */
export const githubRepositoryFullListQuery = queryOptions({
	/** Fetches the full accessible GitHub repository set over IPC with call profiling. */
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemblr:github-repository-list-full', usesDatabase: false },
			() => getEnsemblrApi().githubRepositoryList({ scope: 'full' }),
		),
	queryKey: ensemblrQueryKeys.githubRepositoryList('full'),
	staleTime: 300_000,
});

/** Query options for the renderer-side root directory snapshot. */
export const rootDirectoryQuery = queryOptions({
	/** Fetches the root directory snapshot over IPC with call profiling. */
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemblr:root-directory', usesDatabase: true },
			() => getEnsemblrApi().rootDirectory(),
		),
	queryKey: ensemblrQueryKeys.rootDirectory(),
	staleTime: 5000,
});

/** Query options for the renderer-side repository/workspace navigation snapshot. */
export const repositoryWorkspaceNavigationQuery = queryOptions({
	/** Fetches the repository/workspace navigation snapshot over IPC with call profiling. */
	queryFn: () =>
		profileElectronIpcCall(
			{
				channel: 'ensemblr:repository-workspace-navigation',
				usesDatabase: true,
			},
			() => getEnsemblrApi().repositoryWorkspaceNavigation(),
		),
	queryKey: ensemblrQueryKeys.repositoryWorkspaceNavigation(),
	// Re-read the SQLite-backed nav tree so PR/checks/merge status written by the
	// active-tab poll and the ~120s main-process sweeper reaches sidebar rows
	// without a dedicated broadcast channel. This poll only surfaces what those
	// writers have already persisted; it does not itself refresh gh.
	refetchInterval: 15000,
	staleTime: 2000,
});

/**
 * Query options that read one workspace's pull-request observation out of the
 * cached navigation snapshot: the presentation its sidebar row is mapped from,
 * paired with when that was observed, or null when the workspace has none.
 *
 * It never fetches — the workbench's own subscription to the same key keeps the
 * snapshot polled. The snapshot holds the stamps apart from its tree because
 * they move on every sweep while the presentations mostly do not, and selecting
 * one pair back out per workspace means a consumer re-renders when its own
 * workspace's observation moves rather than whenever any of them does.
 * @param workspaceId - Workspace whose observation to read.
 * @returns Query options selecting that workspace's observation from the cache.
 */
export function workspacePrObservationQuery(workspaceId: string) {
	return queryOptions({
		...repositoryWorkspaceNavigationQuery,
		enabled: false,
		select: (snapshot) => selectPrObservation(snapshot, workspaceId),
	});
}

/**
 * Pairs one workspace's presentation in a navigation snapshot with its stamp.
 * @param snapshot - The cached navigation snapshot.
 * @param workspaceId - Workspace whose observation to read.
 * @returns The presentation and its stamp, or null when the workspace has no pull request.
 */
function selectPrObservation(
	snapshot: RepositoryWorkspaceNavigationSnapshot,
	workspaceId: string,
): StampedWorkspacePrPresentation | null {
	const presentation = snapshot.repositories
		.flatMap((repository) => repository.workspaces)
		.find((workspace) => workspace.id === workspaceId)?.pullRequest;
	const syncedAt = snapshot.pullRequestSyncedAt[workspaceId];
	return presentation && syncedAt ? { presentation, syncedAt } : null;
}
