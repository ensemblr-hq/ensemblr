import { useEffect, useRef } from 'react';

import { subscribePiSessionEvents } from '@/renderer/api/ensemblr';
import { isFinishedTurnEvent } from '@/renderer/hooks/workbench-shell/route-layout/detect-pull-request-creation';
import { useWorkspaceBoardActions } from '@/renderer/state/workspace';

/**
 * Tracks workspace unread state driven by agent activity. Marks a workspace
 * unread whenever one of its Pi agents finishes a turn while that workspace is
 * not the active one, and clears the flag when a workspace becomes active.
 *
 * A single global subscription (not per row) reacts to every workspace's turn
 * boundary, so background workspaces surface a bold sidebar label the moment
 * their agent goes idle. The active id is read through a ref so the subscription
 * does not re-attach on every navigation.
 * @param activeWorkspaceId - The currently open workspace id, or null.
 */
export function useAutoMarkUnread(activeWorkspaceId: string | null): void {
	const { markWorkspaceRead, markWorkspaceUnread } = useWorkspaceBoardActions();
	const activeWorkspaceIdRef = useRef(activeWorkspaceId);

	useEffect(() => {
		activeWorkspaceIdRef.current = activeWorkspaceId;
	}, [activeWorkspaceId]);

	useEffect(() => {
		const unsubscribe = subscribePiSessionEvents((broadcast) => {
			const envelope = broadcast.event.payload;
			if (!envelope || !isFinishedTurnEvent(envelope)) {
				return;
			}
			if (broadcast.workspaceId === activeWorkspaceIdRef.current) {
				return;
			}
			markWorkspaceUnread(broadcast.workspaceId);
		});
		return unsubscribe;
	}, [markWorkspaceUnread]);

	useEffect(() => {
		if (activeWorkspaceId) {
			markWorkspaceRead(activeWorkspaceId);
		}
	}, [activeWorkspaceId, markWorkspaceRead]);
}
