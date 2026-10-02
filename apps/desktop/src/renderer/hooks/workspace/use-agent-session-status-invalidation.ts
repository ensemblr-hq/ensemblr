import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
	ensemblrQueryKeys,
	subscribeAgentSessionEvents,
} from '@/renderer/api/ensemblr-queries';

/**
 * Invalidates a workspace's agent session list whenever an agent `status` event
 * for that workspace arrives, so background (non-focused) surfaces refresh while
 * a session is busy instead of lingering on a stale snapshot. Shared by the
 * sidebar busy indicator and the session-tab strip, which both need the cache to
 * track live status across every session in the workspace.
 * @param workspaceId - Workspace whose agent status events to watch; empty is a no-op.
 */
export function useAgentSessionStatusInvalidation(workspaceId: string): void {
	const queryClient = useQueryClient();
	useEffect(() => {
		if (workspaceId.length === 0) {
			return undefined;
		}
		const unsubscribe = subscribeAgentSessionEvents((broadcast) => {
			if (broadcast.workspaceId !== workspaceId) {
				return;
			}
			if (broadcast.event.eventType !== 'status') {
				return;
			}
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.agentSessionsForWorkspace(workspaceId),
			});
		});
		return unsubscribe;
	}, [queryClient, workspaceId]);
}
