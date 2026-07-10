import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
	ensemblrQueryKeys,
	getEnsemblrApiOrNull,
} from '@/renderer/api/ensemblr/query-keys';

/**
 * Keeps the workspace file list fresh in near-real-time: asks the main process
 * to watch `workspaceCwd` and invalidates the cached file list whenever a
 * change is broadcast. The polling on `workspaceFilesQuery` stays as a coarse
 * fallback for platforms or ignored paths the watcher cannot cover.
 *
 * No-ops when no workspace is active or the preload bridge is unavailable
 * (e.g. tests). Re-subscribes when the active workspace changes.
 * @param workspaceCwd - Absolute workspace path, or null when none is active.
 */
export function useWorkspaceFilesWatch(workspaceCwd: string | null): void {
	const queryClient = useQueryClient();

	useEffect(() => {
		const api = getEnsemblrApiOrNull();

		if (!api || !workspaceCwd) {
			return;
		}

		void api.watchWorkspaceFiles({ workspaceCwd });
		const unsubscribe = api.onWorkspaceFilesChanged((event) => {
			if (event.workspaceCwd !== workspaceCwd) {
				return;
			}

			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.workspaceFiles(workspaceCwd),
			});
		});

		return () => {
			unsubscribe();
			void api.unwatchWorkspaceFiles({ workspaceCwd });
		};
	}, [queryClient, workspaceCwd]);
}
