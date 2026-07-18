import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	ActivateWorkspaceDesktopAppResult,
	DetectWorkspaceDesktopRuntimeResult,
} from '@/shared/ipc/contracts/workspace-runtime';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

/**
 * Query options for a workspace's detected desktop runtime. Detection reads the
 * workspace manifest and run command on the main process, so the result caches
 * indefinitely and is busted only when saving Scripts settings invalidates
 * {@link ensemblrQueryKeys.workspaceDesktopRuntimeAll}.
 * @param workspaceId - Workspace whose desktop runtime to detect.
 */
export function workspaceDesktopRuntimeQuery(workspaceId: string) {
	return queryOptions({
		queryFn: (): Promise<DetectWorkspaceDesktopRuntimeResult> =>
			profileElectronIpcCall(
				{
					channel: 'ensemblr:detect-workspace-desktop-runtime',
					usesDatabase: true,
				},
				() => getEnsemblrApi().detectWorkspaceDesktopRuntime({ workspaceId }),
			),
		queryKey: ensemblrQueryKeys.workspaceDesktopRuntime(workspaceId),
		staleTime: Number.POSITIVE_INFINITY,
	});
}

/** Focuses (or launches) a workspace's running desktop app window on macOS. */
export function activateWorkspaceDesktopApp(
	workspaceId: string,
): Promise<ActivateWorkspaceDesktopAppResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:activate-workspace-desktop-app', usesDatabase: true },
		() => getEnsemblrApi().activateWorkspaceDesktopApp({ workspaceId }),
	);
}
