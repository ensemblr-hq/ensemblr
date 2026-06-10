import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';

import { ensembleQueryKeys, getEnsembleApi } from './query-keys';

/** Query options for the gh-backed GitHub repository list. */
export const githubRepositoryListQuery = queryOptions({
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemble:github-repository-list', usesDatabase: false },
			() => getEnsembleApi().githubRepositoryList(),
		),
	queryKey: ensembleQueryKeys.githubRepositoryList(),
	staleTime: 60_000,
});

/** Query options for the renderer-side root directory snapshot. */
export const rootDirectoryQuery = queryOptions({
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemble:root-directory', usesDatabase: true },
			() => getEnsembleApi().rootDirectory(),
		),
	queryKey: ensembleQueryKeys.rootDirectory(),
	staleTime: 5000,
});

/** Query options for the renderer-side repository/workspace navigation snapshot. */
export const repositoryWorkspaceNavigationQuery = queryOptions({
	queryFn: () =>
		profileElectronIpcCall(
			{
				channel: 'ensemble:repository-workspace-navigation',
				usesDatabase: true,
			},
			() => getEnsembleApi().repositoryWorkspaceNavigation(),
		),
	queryKey: ensembleQueryKeys.repositoryWorkspaceNavigation(),
	staleTime: 2000,
});
