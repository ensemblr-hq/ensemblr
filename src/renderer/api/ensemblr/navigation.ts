import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

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
	staleTime: 2000,
});
