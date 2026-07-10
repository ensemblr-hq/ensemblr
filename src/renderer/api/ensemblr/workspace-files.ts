import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';

import type {
	ReadWorkspaceDirectoryRequest,
	ReadWorkspaceDirectoryResult,
	ReadWorkspaceFileRequest,
	ReadWorkspaceFileResult,
} from '@/shared/ipc/contracts/workspace-files';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

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
				{ channel: 'ensemblr:list-workspace-files', usesDatabase: false },
				() =>
					getEnsemblrApi().listWorkspaceFiles({
						workspaceCwd: workspaceCwd ?? '',
					}),
			),
		queryKey: ensemblrQueryKeys.workspaceFiles(workspaceCwd ?? ''),
		refetchInterval: WORKSPACE_FILES_REFETCH_INTERVAL_MS,
		staleTime: 5_000,
	});
}

/** Reads a selected workspace file so composer @ mentions attach real content. */
export function readWorkspaceFile(
	request: ReadWorkspaceFileRequest,
): Promise<ReadWorkspaceFileResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:read-workspace-file', usesDatabase: false },
		() => getEnsemblrApi().readWorkspaceFile(request),
	);
}

/** Lists an ignored directory's immediate children for lazy tree expansion. */
export function readWorkspaceDirectory(
	request: ReadWorkspaceDirectoryRequest,
): Promise<ReadWorkspaceDirectoryResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:read-workspace-directory', usesDatabase: false },
		() => getEnsemblrApi().readWorkspaceDirectory(request),
	);
}
