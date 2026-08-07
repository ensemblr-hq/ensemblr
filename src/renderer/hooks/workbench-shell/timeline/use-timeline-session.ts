import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
	agentSessionsForWorkspaceQuery,
	turnCheckpointsQuery,
} from '@/renderer/api/ensemblr-queries';
import type {
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

/** The agent session a timeline renders, plus the flags its empty and live states key off. */
export interface TimelineSession {
	/** Checkpoint labels for turns the session captured, keyed by turn id. */
	checkpointsByTurnId: ReadonlyMap<string, { label: string }>;
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
	const checkpointsByTurnId = useMemo(() => {
		const map = new Map<string, { label: string }>();
		for (const checkpoint of checkpointsData?.checkpoints ?? []) {
			if (checkpoint.turnId) {
				map.set(checkpoint.turnId, { label: checkpoint.label });
			}
		}
		return map;
	}, [checkpointsData?.checkpoints]);

	return {
		branchId: activeAgentSession?.branchId ?? '',
		checkpointsByTurnId,
		hasOtherOpenSessions: (sessionsData?.sessions ?? []).some(
			(session) => session.id !== agentSessionId && session.runtimeOpen,
		),
		// Match the composer's busy definition (`starting || streaming`) so the live
		// working indicator + turn timer appear during the pre-first-token gap and
		// stay mounted for the whole agent run rather than flickering per tool round.
		isStreaming:
			activeAgentSession?.status === 'streaming' ||
			activeAgentSession?.status === 'starting',
		agentSessionId,
		sessionResolved: activeAgentSession !== undefined,
		sessionsFetching,
		tabAgentSessionId,
	};
}
