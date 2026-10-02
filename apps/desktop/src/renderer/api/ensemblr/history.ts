import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

/**
 * Query options for the global History feed: every workspace ever created
 * across all repositories, active or archived, ordered by last activity. Backs
 * the History screen; archived entries are unarchived via `unarchiveWorkspace`,
 * which invalidates this key alongside the navigation snapshot.
 */
export function allWorkspacesHistoryQuery() {
	return queryOptions({
		queryFn: () =>
			profileElectronIpcCall(
				{ channel: 'ensemblr:list-all-workspaces', usesDatabase: true },
				() => getEnsemblrApi().listAllWorkspaces(),
			),
		queryKey: ensemblrQueryKeys.workspaceHistory(),
		staleTime: 2000,
	});
}
