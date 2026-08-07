import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { agentSessionsForWorkspaceQuery } from '@/renderer/api/ensemblr-queries';
import { useAgentSessionStatusInvalidation } from './use-agent-session-status-invalidation';

/**
 * Reports whether any agent session attached to `workspaceId` is currently
 * streaming or starting up. Used to drive the workspace sidebar spinner so the
 * row reflects live agent activity, not just the persisted snapshot.
 *
 * The query is shared via TanStack Query so multiple sidebar rows for the same
 * workspace coalesce to one IPC fetch. A workspace-scoped subscription
 * invalidates the cache on every agent status event so an inactive (non-focused)
 * sidebar row still updates while its agent session is busy.
 * @param workspaceId - Workspace whose agent sessions to watch.
 * @returns True while any agent session in the workspace is starting or streaming.
 */
export function useWorkspaceAgentSessionBusy(workspaceId: string): boolean {
	const { data: sessionsData } = useQuery(
		agentSessionsForWorkspaceQuery(workspaceId),
	);
	useAgentSessionStatusInvalidation(workspaceId);

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
