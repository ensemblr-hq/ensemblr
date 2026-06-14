import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';

import { ensembleQueryKeys, getEnsembleApi } from './query-keys';

const GIT_STATUS_REFETCH_INTERVAL_MS = 10_000;

/** Query options for the workspace's changed-file rows and +/- summary. */
export function workspaceGitStatusQuery(workspaceCwd: string | null) {
	return queryOptions({
		enabled: !!workspaceCwd,
		queryFn: () =>
			profileElectronIpcCall(
				{ channel: 'ensemble:get-workspace-git-status', usesDatabase: false },
				() =>
					getEnsembleApi().getWorkspaceGitStatus({
						workspaceCwd: workspaceCwd ?? '',
					}),
			),
		queryKey: ensembleQueryKeys.workspaceGitStatus(workspaceCwd ?? ''),
		refetchInterval: GIT_STATUS_REFETCH_INTERVAL_MS,
		staleTime: 5_000,
	});
}

/** Query options for one file's unified diff against HEAD. */
export function workspaceFileDiffQuery({
	filePath,
	workspaceCwd,
}: {
	filePath: string | null;
	workspaceCwd: string | null;
}) {
	return queryOptions({
		enabled: !!workspaceCwd && !!filePath,
		queryFn: () =>
			profileElectronIpcCall(
				{ channel: 'ensemble:get-workspace-file-diff', usesDatabase: false },
				() =>
					getEnsembleApi().getWorkspaceFileDiff({
						path: filePath ?? '',
						workspaceCwd: workspaceCwd ?? '',
					}),
			),
		queryKey: ensembleQueryKeys.workspaceFileDiff(
			workspaceCwd ?? '',
			filePath ?? '',
		),
		staleTime: 5_000,
	});
}
