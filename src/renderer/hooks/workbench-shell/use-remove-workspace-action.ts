import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useSetAtom } from 'jotai';
import { useCallback } from 'react';

import {
	forgetWorkspaceInListViews,
	invalidateWorkspaceListViews,
} from '@/renderer/api/ensemblr';
import { forgetLastRunScript } from '@/renderer/state/preferences';
import {
	forgetWorkspaceViewedChangesAtom,
	lastWorkspaceNavigationRenderStateAtom,
} from '@/renderer/state/workspace';
import { deleteLastUsedOpenTarget } from '@/renderer/state/workspace/open-target-history';

/**
 * Returns the shared post-removal action for archived or deleted workspaces. It
 * drops the workspace from the cached list views and refreshes them; removing
 * the active one also hops the shell to Welcome.
 *
 * That hop is a consequence of the cached drop rather than a second call
 * alongside it. Clearing the held render state and dropping the workspace from
 * the navigation snapshot together leave `WorkspaceWorkbenchLayout` without a
 * selection, and its one-shot missing-selection layout effect answers that with
 * a single `navigate({ replace: true, to: '/' })`. Calling
 * `navigate()` here as well raced that redirect and ran the index loader — which
 * can itself redirect to a sibling workspace — twice; awaiting it instead left a
 * removed workspace in the sidebar for the life of the process whenever the
 * navigation promise did not settle. Neither is needed: the drop is synchronous
 * and cannot stall.
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

			// The update the UI actually depends on, and the only step here that
			// cannot stall: everything below re-reads through the main process.
			// When the removed workspace is the active one this is also what takes
			// the shell off it, via the layout's own redirect.
			forgetWorkspaceInListViews(queryClient, removedWorkspaceId);

			// That redirect re-runs every loader on the destination route, so the
			// router only needs invalidating when the shell is staying put.
			await Promise.allSettled([
				invalidateWorkspaceListViews(queryClient),
				hopsToWelcome ? Promise.resolve() : router.invalidate(),
			]);
		},
		[
			activeWorkspaceId,
			forgetViewedChanges,
			queryClient,
			router,
			setLastNavigationRenderState,
		],
	);
}
