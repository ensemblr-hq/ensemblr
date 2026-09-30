import { useQuery } from '@tanstack/react-query';
import { useSetAtom } from 'jotai';
import { useEffect } from 'react';

import {
	agentSessionsForWorkspaceQuery,
	subscribeAgentSessionEvents,
} from '@/renderer/api/ensemblr-queries';
import type {
	AgentSessionSnapshotWire,
	ListAgentSessionsResult,
} from '@/shared/ipc/contracts/agent-session';
import {
	applyAgentConversationEventAtom,
	seedAgentConversationSnapshotsAtom,
} from './atoms';

const EMPTY_SESSIONS: readonly AgentSessionSnapshotWire[] = [];

/**
 * Picks the session snapshots out of a workspace listing, so the feed renders
 * again only when the snapshots themselves change.
 * @param result - The workspace's persisted session listing
 * @returns The session snapshots
 */
function selectSessions(
	result: ListAgentSessionsResult,
): readonly AgentSessionSnapshotWire[] {
	return result.sessions;
}

/**
 * Keeps one workspace's live agent state current: seeds it from the session
 * snapshots and applies each broadcast event after them. It lives apart from the
 * Agents panel so the state the close guard and the sidebar read is maintained
 * for as long as the workspace is open, not only while the panel builds rows.
 * @param workspaceId - Workspace whose snapshots and broadcasts feed the state
 */
export function useAgentLiveStateFeed(workspaceId: string): void {
	const { data: sessions = EMPTY_SESSIONS } = useQuery({
		...agentSessionsForWorkspaceQuery(workspaceId),
		select: selectSessions,
	});
	const seedSnapshots = useSetAtom(seedAgentConversationSnapshotsAtom);
	const applyEvent = useSetAtom(applyAgentConversationEventAtom);

	useEffect(() => {
		seedSnapshots({ sessions, workspaceId });
	}, [seedSnapshots, sessions, workspaceId]);

	useEffect(
		() =>
			subscribeAgentSessionEvents((broadcast) => {
				if (
					broadcast.workspaceId !== workspaceId ||
					broadcast.event.payload === null
				) {
					return;
				}
				applyEvent({
					branchId: broadcast.event.branchId,
					envelope: broadcast.event.payload,
					ordinal: broadcast.event.ordinal,
					sessionId: broadcast.sessionId,
					workspaceId,
				});
			}),
		[applyEvent, workspaceId],
	);
}
