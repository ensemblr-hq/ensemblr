import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useCallback } from 'react';

import { invalidateWorkspaceListViews } from '@/renderer/api/ensemblr';
import { useDisableProjectReorderLayoutAnimation } from '@/renderer/state/workspace';
import { deleteLastUsedOpenTarget } from '@/renderer/state/workspace/open-target-history';

/**
 * Returns the shared post-removal action for archived or deleted workspaces.
 * It suppresses sidebar layout motion before invalidating the workspace list,
 * and redirects only when the removed workspace is active.
 * @param options - Active workspace identity used to choose the route fallback.
 * @returns A callback that removes one workspace from renderer navigation state.
 */
export function useRemoveWorkspaceAction(options: {
	activeWorkspaceId: string | null;
}) {
	const { activeWorkspaceId } = options;
	const disableProjectReorderLayoutAnimation =
		useDisableProjectReorderLayoutAnimation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const router = useRouter();

	return useCallback(
		async (removedWorkspaceId: string) => {
			disableProjectReorderLayoutAnimation();
			deleteLastUsedOpenTarget(removedWorkspaceId);

			if (activeWorkspaceId === removedWorkspaceId) {
				await navigate({ replace: true, to: '/' });
			}

			await invalidateWorkspaceListViews(queryClient);
			await router.invalidate();
		},
		[
			activeWorkspaceId,
			disableProjectReorderLayoutAnimation,
			navigate,
			queryClient,
			router,
		],
	);
}
