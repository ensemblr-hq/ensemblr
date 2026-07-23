import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { piSessionsForWorkspaceQuery } from '@/renderer/api/ensemblr-queries';
import { usePiSessionStatusInvalidation } from './use-pi-session-status-invalidation';

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
	const { data: sessionsData } = useQuery(
		piSessionsForWorkspaceQuery(workspaceId),
	);
	usePiSessionStatusInvalidation(workspaceId);

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
