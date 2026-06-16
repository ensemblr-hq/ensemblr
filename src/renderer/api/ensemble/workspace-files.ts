import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';

import type {
	ReadWorkspaceFileRequest,
	ReadWorkspaceFileResult,
} from '@/shared/ipc/contracts/workspace-files';

import { ensembleQueryKeys, getEnsembleApi } from './query-keys';

// Coarse fallback poll. A main-process fs watcher invalidates this query within
// ~250ms of a real change (see useWorkspaceFilesWatch); this interval only
// covers what the watcher can't — ignored dirs and platforms without recursive
// watch. React Query pauses it while the window is blurred.
const WORKSPACE_FILES_REFETCH_INTERVAL_MS = 30_000;

/** Query options for enumerating workspace files for the files tree and @ mentions. */
export function workspaceFilesQuery(workspaceCwd: string | null) {
	return queryOptions({
		enabled: !!workspaceCwd,
		queryFn: () =>
			profileElectronIpcCall(
				{ channel: 'ensemble:list-workspace-files', usesDatabase: false },
				() =>
					getEnsembleApi().listWorkspaceFiles({
						workspaceCwd: workspaceCwd ?? '',
					}),
			),
		queryKey: ensembleQueryKeys.workspaceFiles(workspaceCwd ?? ''),
		refetchInterval: WORKSPACE_FILES_REFETCH_INTERVAL_MS,
		staleTime: 5_000,
	});
}

/** Reads a selected workspace file so composer @ mentions attach real content. */
export function readWorkspaceFile(
	request: ReadWorkspaceFileRequest,
): Promise<ReadWorkspaceFileResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:read-workspace-file', usesDatabase: false },
		() => getEnsembleApi().readWorkspaceFile(request),
	);
}
