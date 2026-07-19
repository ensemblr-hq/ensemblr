import { useCallback } from 'react';
import { toast } from 'sonner';

import { getEnsemblrApiOrNull } from '@/renderer/api/ensemblr';
import type {
	OpenTargetPathOptions,
	OpenTargetsState,
	WorkspaceOpenTarget,
} from '@/renderer/types/workbench';

import { useOpenTargetMenu } from './use-open-target-menu';

/**
 * Workspace flavour of the open-in menu: reuses {@link useOpenTargetMenu} for
 * the detected-app list and last-used memory, then invokes the workspace IPC
 * channel. Opening the workspace root repoints the last-used pointer; opening
 * an individual file (with `options`) leaves it untouched.
 */
export function useOpenTargets({
	workspaceId,
}: {
	workspaceId: string;
}): OpenTargetsState {
	const { openTargets, primaryTarget, rememberTarget } =
		useOpenTargetMenu(workspaceId);

	const invokeTarget = useCallback(
		async (target: WorkspaceOpenTarget, options?: OpenTargetPathOptions) => {
			const ensemblr = getEnsemblrApiOrNull();
			if (!ensemblr) {
				toast.error('Open in… is unavailable without the Electron bridge.');
				return;
			}
			const result = await ensemblr.openWorkspaceInTarget({
				targetId: target.id,
				workspaceId,
				...(options
					? {
							relativePath: options.relativePath,
							relativePathKind: options.relativePathKind,
						}
					: {}),
			});
			if (!result.ok) {
				toast.error(`Failed to open in ${target.label}: ${result.error}`);
				return;
			}
			// Quick-launch memory is for the header split button (workspace root);
			// don't let opening an individual file repoint it.
			if (target.behavior !== 'copy-path' && !options) {
				rememberTarget(target.id);
			}
			if (target.behavior === 'copy-path') {
				toast.success(
					options ? 'Path copied to clipboard.' : 'Workspace path copied.',
				);
			}
		},
		[rememberTarget, workspaceId],
	);

	return { invokeTarget, openTargets, primaryTarget };
}
