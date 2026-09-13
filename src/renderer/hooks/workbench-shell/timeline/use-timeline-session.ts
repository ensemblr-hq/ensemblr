import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

import {
	agentSessionsForWorkspaceQuery,
	ensemblrQueryKeys,
	turnCheckpointsQuery,
} from '@/renderer/api/ensemblr-queries';
import {
	type TurnCheckpointScope,
	turnCheckpointScopes,
} from '@/renderer/lib/workbench';
import type {
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

/** The agent session a timeline renders, plus the flags its empty and live states key off. */
export interface TimelineSession {
	/**
	 * Each checkpointed turn's label and the diff scope covering what that turn
	 * changed, keyed by turn id.
	 */
	checkpointsByTurnId: ReadonlyMap<string, TurnCheckpointScope>;
	branchId: string;
	/** Another live session in the same workspace could clobber a restore. */
	hasOtherOpenSessions: boolean;
	isStreaming: boolean;
	agentSessionId: string | null;
	/** Whether the session list is still in flight. */
	sessionsFetching: boolean;
	/** Whether the workspace's session list has caught up with this tab. */
	sessionResolved: boolean;
	/** The session id the tab is bound to, before the list resolves it. */
	tabAgentSessionId: string | null;
}

/**
 * Resolves the agent session behind a chat tab and the checkpoints it captured.
 * @param activeAgentSessionId - Fallback session id when the tab carries none
 * @param activeSession - The chat tab being rendered
 * @param workspace - Workspace whose session list is queried
 * @returns The resolved session and the flags the timeline branches on
 */
export function useTimelineSession({
	activeAgentSessionId,
	activeSession,
	workspace,
}: {
	activeAgentSessionId: string | null;
	activeSession: SessionTabModel;
	workspace: WorkspaceShellModel;
}): TimelineSession {
	const { data: sessionsData, isFetching: sessionsFetching } = useQuery(
		agentSessionsForWorkspaceQuery(workspace.id),
	);
	const tabAgentSessionId =
		activeSession.agentSessionId ?? activeAgentSessionId;
	const activeAgentSession =
		tabAgentSessionId === null
			? undefined
			: sessionsData?.sessions.find(
					(session) => session.id === tabAgentSessionId,
				);
	const agentSessionId = activeAgentSession?.id ?? null;

	const { data: checkpointsData } = useQuery(
		turnCheckpointsQuery(agentSessionId),
	);
	const checkpointsByTurnId = useMemo(
		() => turnCheckpointScopes(checkpointsData?.checkpoints ?? []),
		[checkpointsData?.checkpoints],
	);

	// Capture happens in main before the next prompt, and the checkpoint query
	// neither polls nor is invalidated by the event stream — so without this the
	// turn that just finished has no checkpoint until the tab remounts, and its
	// diff affordances stay hidden.
	const isStreaming =
		activeAgentSession?.status === 'streaming' ||
		activeAgentSession?.status === 'starting';
	useCheckpointRefreshOnTurnEnd({
		agentSessionId,
		isStreaming,
		workspaceId: workspace.id,
	});

	return {
		branchId: activeAgentSession?.branchId ?? '',
		checkpointsByTurnId,
		hasOtherOpenSessions: (sessionsData?.sessions ?? []).some(
			(session) => session.id !== agentSessionId && session.runtimeOpen,
		),
		// Match the composer's busy definition (`starting || streaming`) so the live
		// working indicator + turn timer appear during the pre-first-token gap and
		// stay mounted for the whole agent run rather than flickering per tool round.
		isStreaming,
		agentSessionId,
		sessionResolved: activeAgentSession !== undefined,
		sessionsFetching,
		tabAgentSessionId,
	};
}

/**
 * Refetches the checkpoint lists once a turn stops streaming, so the newly
 * captured checkpoint reaches the timeline and the Changes panel without
 * waiting for a remount.
 * @param agentSessionId - Session whose checkpoint list to refresh
 * @param isStreaming - Whether the session is mid-turn
 * @param workspaceId - Workspace whose checkpoint list to refresh
 */
function useCheckpointRefreshOnTurnEnd({
	agentSessionId,
	isStreaming,
	workspaceId,
}: {
	agentSessionId: string | null;
	isStreaming: boolean;
	workspaceId: string;
}): void {
	const queryClient = useQueryClient();
	const wasStreamingRef = useRef(isStreaming);

	useEffect(() => {
		const wasStreaming = wasStreamingRef.current;
		wasStreamingRef.current = isStreaming;
		if (isStreaming || !wasStreaming) {
			return;
		}
		if (agentSessionId) {
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.checkpointsForSession(agentSessionId),
			});
		}
		void queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.checkpointsForWorkspace(workspaceId),
		});
	}, [agentSessionId, isStreaming, queryClient, workspaceId]);
}
