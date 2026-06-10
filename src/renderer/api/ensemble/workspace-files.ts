import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';

import type {
	ReadWorkspaceFileRequest,
	ReadWorkspaceFileResult,
} from '@/shared/ipc';

import { ensembleQueryKeys, getEnsembleApi } from './query-keys';

/** Query options for enumerating workspace files for composer @ mentions. */
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
		staleTime: 30_000,
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
