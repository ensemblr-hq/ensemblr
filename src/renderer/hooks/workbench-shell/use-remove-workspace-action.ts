import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useSetAtom } from 'jotai';
import { useCallback } from 'react';

import { invalidateWorkspaceListViews } from '@/renderer/api/ensemblr';
import { forgetLastRunScript } from '@/renderer/state/preferences';
import {
	forgetWorkspaceViewedChangesAtom,
	lastWorkspaceNavigationRenderStateAtom,
	lastWorkspaceSelectionAtom,
} from '@/renderer/state/workspace';
import { deleteLastUsedOpenTarget } from '@/renderer/state/workspace/open-target-history';

/**
 * Returns the shared post-removal action for archived or deleted workspaces.
 * It invalidates the workspace list and redirects only when the removed
 * workspace is active.
 * @param options - Active workspace identity used to choose the route fallback.
 * @returns A callback that removes one workspace from renderer navigation state.
 */
export function useRemoveWorkspaceAction(options: {
	activeWorkspaceId: string | null;
}) {
	const { activeWorkspaceId } = options;
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const router = useRouter();
	const forgetViewedChanges = useSetAtom(forgetWorkspaceViewedChangesAtom);
	const setLastWorkspaceSelection = useSetAtom(lastWorkspaceSelectionAtom);
	const setLastNavigationRenderState = useSetAtom(
		lastWorkspaceNavigationRenderStateAtom,
	);

	return useCallback(
		async (removedWorkspaceId: string) => {
			deleteLastUsedOpenTarget(removedWorkspaceId);
			forgetLastRunScript(removedWorkspaceId);
			forgetViewedChanges(removedWorkspaceId);
			// Both of these name a workspace that no longer exists. The stored pair is
			// persisted, and the render state is the fallback the shell holds up while
			// navigation resolves, so leaving either pointing at the removed workspace
			// keeps resolving a selection the loaders then have to redirect away from.
			setLastWorkspaceSelection((selection) =>
				selection?.workspaceId === removedWorkspaceId ? null : selection,
			);
			setLastNavigationRenderState((renderState) =>
				renderState?.selection.workspace.id === removedWorkspaceId
					? null
					: renderState,
			);

			if (activeWorkspaceId === removedWorkspaceId) {
				await navigate({ replace: true, to: '/' });
			}

			await invalidateWorkspaceListViews(queryClient);
			await router.invalidate();
		},
		[
			activeWorkspaceId,
			forgetViewedChanges,
			navigate,
			queryClient,
			router,
			setLastNavigationRenderState,
			setLastWorkspaceSelection,
		],
	);
}
