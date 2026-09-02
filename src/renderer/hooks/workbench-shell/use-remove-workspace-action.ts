import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useSetAtom } from 'jotai';
import { useCallback, useMemo } from 'react';

import {
	forgetWorkspaceInListViews,
	invalidateWorkspaceListViews,
} from '@/renderer/api/ensemblr';
import { forgetLastRunScript } from '@/renderer/state/preferences';
import {
	forgetWorkspaceStateAtom,
	lastWorkspaceNavigationRenderStateAtom,
} from '@/renderer/state/workspace';
import { deleteLastUsedOpenTarget } from '@/renderer/state/workspace/open-target-history';

/**
 * The post-removal action, one entry per reason a workspace can leave the
 * sidebar. Archiving is reversible from the History screen and the Browse
 * archive dialog; deleting is not, and only deleting evicts remembered state.
 */
export interface WorkspaceRemovalActions {
	archived: (archivedWorkspaceId: string) => Promise<void>;
	deleted: (deletedWorkspaceId: string) => Promise<void>;
}

/**
 * Returns the shared post-removal action for archived or deleted workspaces. It
 * drops the workspace from the cached list views and refreshes them; removing
 * the active one also hops the shell to Welcome.
 *
 * Only a delete evicts the workspace's remembered state. An archived workspace
 * can be unarchived, and it has to come back with its board column, its pin,
 * its remembered tabs and its run script — `useReconcileWorkspaceState` is what
 * finally collects those, once the workspace is purged for good.
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
 * @returns One removal callback per lifecycle reason.
 */
export function useRemoveWorkspaceAction(options: {
	activeWorkspaceId: string | null;
}): WorkspaceRemovalActions {
	const { activeWorkspaceId } = options;
	const queryClient = useQueryClient();
	const router = useRouter();
	const forgetWorkspaceState = useSetAtom(forgetWorkspaceStateAtom);
	const setLastNavigationRenderState = useSetAtom(
		lastWorkspaceNavigationRenderStateAtom,
	);

	const dropFromNavigation = useCallback(
		async (removedWorkspaceId: string) => {
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
		[activeWorkspaceId, queryClient, router, setLastNavigationRenderState],
	);

	return useMemo(
		() => ({
			archived: dropFromNavigation,
			deleted: async (deletedWorkspaceId: string) => {
				deleteLastUsedOpenTarget(deletedWorkspaceId);
				forgetLastRunScript(deletedWorkspaceId);
				forgetWorkspaceState(deletedWorkspaceId);
				await dropFromNavigation(deletedWorkspaceId);
			},
		}),
		[dropFromNavigation, forgetWorkspaceState],
	);
}

/**
 * The post-removal action for a surface that runs its teardown behind
 * {@link useWorkspaceTeardownHop}, which leaves the active workspace *before*
 * the IPC rather than after it.
 *
 * {@link useRemoveWorkspaceAction} skips its own `router.invalidate()` when the
 * removed workspace is the active one, because losing the selection is what
 * fires the layout's redirect and that redirect re-runs every loader. A hop
 * spends that redirect up front, so by the time the workspace is actually gone
 * there is nothing left to re-run the loaders — this adds back the one
 * invalidation the redirect used to cover.
 *
 * Surfaces that tear down the active workspace *without* hopping first — the
 * archive-after-merge mutation in `use-review-mutations.ts` — must keep using
 * {@link useRemoveWorkspaceAction}: there the redirect still fires, and a second
 * invalidation would race it into the index loader twice.
 * @param options - Active workspace identity used to choose the route fallback.
 * @returns One removal callback per lifecycle reason.
 */
export function useRemoveHoppedWorkspaceAction(options: {
	activeWorkspaceId: string | null;
}): WorkspaceRemovalActions {
	const { activeWorkspaceId } = options;
	const router = useRouter();
	const removeWorkspace = useRemoveWorkspaceAction(options);

	return useMemo(
		() => ({
			archived: async (archivedWorkspaceId: string) => {
				await removeWorkspace.archived(archivedWorkspaceId);
				if (activeWorkspaceId === archivedWorkspaceId) {
					await router.invalidate();
				}
			},
			deleted: async (deletedWorkspaceId: string) => {
				await removeWorkspace.deleted(deletedWorkspaceId);
				if (activeWorkspaceId === deletedWorkspaceId) {
					await router.invalidate();
				}
			},
		}),
		[
			activeWorkspaceId,
			removeWorkspace.archived,
			removeWorkspace.deleted,
			router,
		],
	);
}
