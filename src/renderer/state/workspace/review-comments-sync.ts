import { ensemblrQueryKeys } from '@/renderer/api/ensemblr-queries';
import { queryClient } from '@/renderer/api/query-client';

/**
 * Wires an agent's review-comment writes into the renderer's comment cache.
 *
 * The comment list is a cached query that only renderer-local mutations
 * invalidate, and the query client refetches neither on an interval nor on
 * window focus — so a user watching the Changes panel while an agent reviews
 * would see nothing until the panel remounted. Invalidating on the broadcast
 * makes an agent's comments land the moment it files them.
 *
 * Installed once for the app rather than per panel, because both the diff viewer
 * and the Checks panel read the same query and either may be the one mounted.
 * @returns A teardown function that removes the subscription.
 */
export function installAgentControlReviewCommentsSync(): () => void {
	const unsubscribe = window.ensemblr?.onAgentControlReviewCommentsChanged(
		({ workspaceId }) => {
			queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.reviewComments(workspaceId),
			});
		},
	);
	return () => unsubscribe?.();
}
