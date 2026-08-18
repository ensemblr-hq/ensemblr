import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useSetAtom } from 'jotai';
import { useCallback } from 'react';

import { invalidateWorkspaceListViews } from '@/renderer/api/ensemblr';
import { forgetLastRunScript } from '@/renderer/state/preferences';
import {
	forgetWorkspaceViewedChangesAtom,
	lastWorkspaceNavigationRenderStateAtom,
} from '@/renderer/state/workspace';
import { deleteLastUsedOpenTarget } from '@/renderer/state/workspace/open-target-history';

/**
 * Returns the shared post-removal action for archived or deleted workspaces.
 * It invalidates the workspace list and redirects only when the removed
 * workspace is active.
 *
 * The persisted workspace selection is deliberately kept: the index loader
 * reads a stored pair whose workspace vanished as "open a sibling in that
 * project, else stay on Welcome", while clearing it downgrades the hop to the
 * first-launch rule and lands the user in an unrelated project's first
 * workspace.
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
	const setLastNavigationRenderState = useSetAtom(
		lastWorkspaceNavigationRenderStateAtom,
	);

	return useCallback(
		async (removedWorkspaceId: string) => {
			deleteLastUsedOpenTarget(removedWorkspaceId);
			forgetLastRunScript(removedWorkspaceId);
			forgetViewedChanges(removedWorkspaceId);
			// The shell holds this render state up while navigation resolves, so one
			// naming the removed workspace renders against a workspace that is gone.
			setLastNavigationRenderState((renderState) =>
				renderState?.selection.workspace.id === removedWorkspaceId
					? null
					: renderState,
			);

			const hopsToWelcome = activeWorkspaceId === removedWorkspaceId;

			// Hop first: a list refresh landing while the shell still sits on the
			// removed workspace leaves it selectionless, and the workspace layout
			// answers that with its own redirect to Welcome — a second navigation.
			if (hopsToWelcome) {
				await navigate({ replace: true, to: '/' });
			}

			await invalidateWorkspaceListViews(queryClient);

			// The hop above already re-ran every loader on the destination route.
			if (!hopsToWelcome) {
				await router.invalidate();
			}
		},
		[
			activeWorkspaceId,
			forgetViewedChanges,
			navigate,
			queryClient,
			router,
			setLastNavigationRenderState,
		],
	);
}
