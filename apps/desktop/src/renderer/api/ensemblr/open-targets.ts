import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	ListWorkspaceOpenTargetsResult,
	OpenSettingsFileInTargetRequest,
	OpenTargetResult,
} from '@/shared/ipc/contracts/open-target';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

/**
 * Query options for the installed-app list backing the workbench "Open in…"
 * menu. Detection runs once at app boot in the main process; we cache forever
 * and let consumers `invalidateQueries` after a manual rescan.
 */
export const workspaceOpenTargetsQuery = queryOptions({
	/** Fetches the installed "Open in…" app targets over IPC with call profiling. */
	queryFn: (): Promise<ListWorkspaceOpenTargetsResult> =>
		profileElectronIpcCall(
			{
				channel: 'ensemblr:list-workspace-open-targets',
				usesDatabase: false,
			},
			() => getEnsemblrApi().listWorkspaceOpenTargets(),
		),
	queryKey: ensemblrQueryKeys.workspaceOpenTargets(),
	staleTime: Number.POSITIVE_INFINITY,
});

/**
 * Opens a settings config file (`config.json` or `.ensemblr/settings.toml`) in
 * the chosen "Open in…" target app, reusing the workbench open-target registry.
 * @param request - The target app id and which settings file to open.
 * @returns The open result, `{ ok: false }` with a message on failure.
 */
export function openSettingsFileInTarget(
	request: OpenSettingsFileInTargetRequest,
): Promise<OpenTargetResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:open-settings-file-in-target', usesDatabase: false },
		() => getEnsemblrApi().openSettingsFileInTarget(request),
	);
}
