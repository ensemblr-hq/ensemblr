import { useQuery } from '@tanstack/react-query';

import { agentSessionsForWorkspaceQuery } from '@/renderer/api/ensemblr-queries';

/**
 * Whether any agent session is persisted for the workspace, or null while the
 * list is still in flight.
 *
 * The tri-state is the point: a first-run affordance gated on "nothing has
 * happened here yet" has to tell *no sessions* apart from *not known yet*, which
 * a plain boolean collapses into offering the affordance on every first paint.
 * The answer covers closed chats too — the query lists the workspace's sessions,
 * not its open tabs — so closing the chat that used the workspace does not read
 * as never having used it.
 *
 * A failed read answers `false` rather than `null`. `null` means *ask again in a
 * moment*, and a query that has exhausted its retries never will, so reporting it
 * would strand every caller on the unknown branch for the life of the cache
 * entry. Answering `false` costs at worst a first-run affordance offered once too
 * often, against a caller that would otherwise go dark with nothing to show for
 * it.
 * @param workspaceId - Workspace whose persisted agent sessions to read.
 * @returns True once the workspace holds a session, false once it is known (or assumed, after a failed read) to hold none, null while still loading.
 */
export function useWorkspaceConversationStarted(
	workspaceId: string,
): boolean | null {
	const { data, isError, isSuccess } = useQuery(
		agentSessionsForWorkspaceQuery(workspaceId),
	);
	if (isSuccess) {
		return data.sessions.length > 0;
	}
	return isError ? false : null;
}
