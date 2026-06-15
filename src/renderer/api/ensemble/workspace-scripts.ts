import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	RunWorkspaceScriptRequest,
	RunWorkspaceScriptResult,
	StopWorkspaceScriptRequest,
	StopWorkspaceScriptResult,
} from '@/shared/ipc/contracts/workspace-scripts';
import {
	parseWorkspaceScriptSettings,
	type WorkspaceScriptSettings,
} from '@/shared/scripts/script-settings';

import { ensembleQueryKeys, getEnsembleApi } from './query-keys';

/** Query options for the repository's resolved script settings. */
export function workspaceScriptSettingsQuery(
	repository: { repositoryId: string; repositoryPath: string } | null,
) {
	return queryOptions({
		enabled: !!repository,
		queryFn: async (): Promise<WorkspaceScriptSettings> => {
			const snapshot = await profileElectronIpcCall(
				{ channel: 'ensemble:settings-resolution', usesDatabase: true },
				() =>
					getEnsembleApi().resolveSettings({
						repository: repository ?? undefined,
					}),
			);

			return parseWorkspaceScriptSettings(snapshot.repository?.settings ?? []);
		},
		queryKey: ensembleQueryKeys.workspaceScriptSettings(
			repository?.repositoryId ?? '',
		),
		staleTime: 30_000,
	});
}

/** Runs a configured workspace script in a dock terminal session. */
export function runWorkspaceScript(
	request: RunWorkspaceScriptRequest,
): Promise<RunWorkspaceScriptResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:run-workspace-script', usesDatabase: true },
		() => getEnsembleApi().runWorkspaceScript(request),
	);
}

/** Stops the active workspace script session of the given kind. */
export function stopWorkspaceScript(
	request: StopWorkspaceScriptRequest,
): Promise<StopWorkspaceScriptResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:stop-workspace-script', usesDatabase: false },
		() => getEnsembleApi().stopWorkspaceScript(request),
	);
}
