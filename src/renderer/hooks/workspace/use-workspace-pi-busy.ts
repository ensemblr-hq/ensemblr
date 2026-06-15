import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import {
	ensembleQueryKeys,
	piSessionsForWorkspaceQuery,
	subscribePiSessionEvents,
} from '@/renderer/api/ensemble-queries';

/**
 * Reports whether any Pi session attached to `workspaceId` is currently
 * streaming or starting up. Used to drive the workspace sidebar spinner so the
 * row reflects live agent activity, not just the persisted snapshot.
 *
 * The query is shared via TanStack Query so multiple sidebar rows for the same
 * workspace coalesce to one IPC fetch. A workspace-scoped subscription
 * invalidates the cache on every Pi status event so an inactive (non-focused)
 * sidebar row still updates while its Pi session is busy.
 */
export function useWorkspacePiBusy(workspaceId: string): boolean {
	const queryClient = useQueryClient();
	const { data: sessionsData } = useQuery(
		piSessionsForWorkspaceQuery(workspaceId),
	);

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
				queryKey: ensembleQueryKeys.piSessionsForWorkspace(workspaceId),
			});
		});
		return unsubscribe;
	}, [queryClient, workspaceId]);

	const sessions = sessionsData?.sessions;
	return useMemo(() => {
		if (!sessions) {
			return false;
		}
		return sessions.some(
			(session) =>
				session.runtimeOpen &&
				(session.status === 'starting' || session.status === 'streaming'),
		);
	}, [sessions]);
}
