import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
	ensemblrQueryKeys,
	subscribePiSessionEvents,
} from '@/renderer/api/ensemblr-queries';

/**
 * Invalidates a workspace's Pi session list whenever a Pi `status` event for that
 * workspace arrives, so background (non-focused) surfaces refresh while a session
 * is busy instead of lingering on a stale snapshot. Shared by the sidebar busy
 * indicator and the session-tab strip, which both need the cache to track live
 * status across every session in the workspace.
 * @param workspaceId - Workspace whose Pi status events to watch; empty is a no-op.
 */
export function usePiSessionStatusInvalidation(workspaceId: string): void {
	const queryClient = useQueryClient();
	useEffect(() => {
		if (workspaceId.length === 0) {
			return undefined;
		}
		const unsubscribe = subscribePiSessionEvents((broadcast) => {
			if (broadcast.workspaceId !== workspaceId) {
				return;
			}
			if (broadcast.event.eventType !== 'status') {
				return;
			}
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.piSessionsForWorkspace(workspaceId),
			});
		});
		return unsubscribe;
	}, [queryClient, workspaceId]);
}
