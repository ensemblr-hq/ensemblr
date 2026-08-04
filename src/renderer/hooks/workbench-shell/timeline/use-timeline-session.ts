import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
	piSessionsForWorkspaceQuery,
	turnCheckpointsQuery,
} from '@/renderer/api/ensemblr-queries';
import type {
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

/** The Pi session a timeline renders, plus the flags its empty and live states key off. */
export interface TimelineSession {
	/** Checkpoint labels for turns the session captured, keyed by turn id. */
	checkpointsByTurnId: ReadonlyMap<string, { label: string }>;
	branchId: string;
	/** Another live session in the same workspace could clobber a restore. */
	hasOtherOpenSessions: boolean;
	isStreaming: boolean;
	piSessionId: string | null;
	/** Whether the session list is still in flight. */
	sessionsFetching: boolean;
	/** Whether the workspace's session list has caught up with this tab. */
	sessionResolved: boolean;
	/** The session id the tab is bound to, before the list resolves it. */
	tabPiSessionId: string | null;
}

/**
 * Resolves the Pi session behind a chat tab and the checkpoints it captured.
 * @param activePiSessionId - Fallback session id when the tab carries none
 * @param activeSession - The chat tab being rendered
 * @param workspace - Workspace whose session list is queried
 * @returns The resolved session and the flags the timeline branches on
 */
export function useTimelineSession({
	activePiSessionId,
	activeSession,
	workspace,
}: {
	activePiSessionId: string | null;
	activeSession: SessionTabModel;
	workspace: WorkspaceShellModel;
}): TimelineSession {
	const { data: sessionsData, isFetching: sessionsFetching } = useQuery(
		piSessionsForWorkspaceQuery(workspace.id),
	);
	const tabPiSessionId = activeSession.piSessionId ?? activePiSessionId;
	const activePiSession =
		tabPiSessionId === null
			? undefined
			: sessionsData?.sessions.find((session) => session.id === tabPiSessionId);
	const piSessionId = activePiSession?.id ?? null;

	const { data: checkpointsData } = useQuery(turnCheckpointsQuery(piSessionId));
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
		branchId: activePiSession?.branchId ?? '',
		checkpointsByTurnId,
		hasOtherOpenSessions: (sessionsData?.sessions ?? []).some(
			(session) => session.id !== piSessionId && session.runtimeOpen,
		),
		// Match the composer's busy definition (`starting || streaming`) so the live
		// working indicator + turn timer appear during the pre-first-token gap and
		// stay mounted for the whole agent run rather than flickering per tool round.
		isStreaming:
			activePiSession?.status === 'streaming' ||
			activePiSession?.status === 'starting',
		piSessionId,
		sessionResolved: activePiSession !== undefined,
		sessionsFetching,
		tabPiSessionId,
	};
}
