import { useAtom } from 'jotai';
import type {
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { SessionTabState } from '@/renderer/types/workbench-shell';
import { closedSessionIdsByWorkspaceAtom } from './atoms';

/**
 * React hook that exposes session-tab state for a workspace — visible vs.
 * closed sessions plus close/restore helpers backed by a persisted atom.
 * @param input - Active session/workspace plus tab-change callback.
 * @returns A {@link SessionTabState} for the conversation bar.
 */
export function useSessionTabState({
	activeSession,
	activeWorkspace,
	onSessionTabChange,
}: {
	activeSession: SessionTabModel;
	activeWorkspace: WorkspaceShellModel;
	onSessionTabChange: (sessionId: string) => void;
}): SessionTabState {
	const [closedSessionIdsByWorkspace, setClosedSessionIdsByWorkspace] = useAtom(
		closedSessionIdsByWorkspaceAtom,
	);
	const closedSessionIds =
		closedSessionIdsByWorkspace[activeWorkspace.id] ?? [];
	const visibleSessions = activeWorkspace.sessions.filter(
		(session) => !closedSessionIds.includes(session.id),
	);
	const closedSessions = activeWorkspace.sessions.filter((session) =>
		closedSessionIds.includes(session.id),
	);
	const sessionTabs = visibleSessions.length
		? visibleSessions
		: activeWorkspace.sessions;
	const effectiveActiveSession =
		sessionTabs.find((session) => session.id === activeSession.id) ??
		sessionTabs[0] ??
		activeSession;

	/** Persists a session as closed and advances to a neighboring tab. */
	const closeSessionTab = (sessionId: string) => {
		if (sessionTabs.length <= 1) {
			return;
		}

		const closingIndex = sessionTabs.findIndex(
			(session) => session.id === sessionId,
		);
		const nextSession =
			sessionTabs[closingIndex + 1] ??
			sessionTabs[closingIndex - 1] ??
			sessionTabs.find((session) => session.id !== sessionId);

		setClosedSessionIdsByWorkspace((current) => {
			const workspaceClosedIds = current[activeWorkspace.id] ?? [];

			if (workspaceClosedIds.includes(sessionId)) {
				return current;
			}

			return {
				...current,
				[activeWorkspace.id]: [...workspaceClosedIds, sessionId],
			};
		});

		if (activeSession.id === sessionId && nextSession) {
			onSessionTabChange(nextSession.id);
		}
	};
	/** Re-opens a previously-closed session tab and activates it. */
	const restoreSessionTab = (sessionId: string) => {
		setClosedSessionIdsByWorkspace((current) => {
			const workspaceClosedIds = current[activeWorkspace.id] ?? [];
			const nextWorkspaceClosedIds = workspaceClosedIds.filter(
				(closedSessionId) => closedSessionId !== sessionId,
			);

			return {
				...current,
				[activeWorkspace.id]: nextWorkspaceClosedIds,
			};
		});
		onSessionTabChange(sessionId);
	};

	return {
		closedSessions,
		closeSessionTab,
		effectiveActiveSession,
		restoreSessionTab,
		sessionTabs,
	};
}
