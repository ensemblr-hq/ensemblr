import { useCallback, useMemo } from 'react';
import {
	type useAgentComposerController,
	useStopAgentSession,
} from '@/renderer/state/composer';
import { useMenuCommand } from '@/renderer/state/menu-commands';
import {
	resolveRunningCloseTarget,
	useCloseRunningChatGuard,
	type useSessionTabState,
} from '@/renderer/state/workspace';

/**
 * Routes ⌘/Ctrl+W and tab-strip closes through the running-chat guard.
 *
 * The underlying close policy (close, no-op, or reset the sole chat) still lives
 * in `useSessionTabState` (see `decideActiveClose`); the guard only adds a
 * confirm-then-cancel step when the target tab's agent is mid-turn. It belongs
 * at this seam because this is the one place holding both the registered close
 * action and the composer's live streaming state.
 * @param activeSessionId - Id of the chat tab currently in the foreground
 * @param agentComposer - Live composer controller for the active tab
 * @param sessionNavigation - Session tab state whose close is being wrapped
 * @param workspaceId - Workspace the background stop calls are scoped to
 * @returns The guard's dialog state, and session navigation with a guarded close
 */
export function useGuardedSessionClose({
	activeSessionId,
	agentComposer,
	sessionNavigation,
	workspaceId,
}: {
	activeSessionId: string;
	agentComposer: ReturnType<typeof useAgentComposerController>;
	sessionNavigation: ReturnType<typeof useSessionTabState>;
	workspaceId: string;
}) {
	const closeGuard = useCloseRunningChatGuard();
	const stopAgentSessionById = useStopAgentSession(workspaceId);

	const stopFor = useCallback(
		(targetId: string, agentSessionId: string | null) => async () => {
			// The active tab owns the live composer, so prefer its `onStop` (it also
			// clears the composer's optimistic pending session). Background tabs have
			// no live composer; cancel them by session id instead.
			if (targetId === activeSessionId) {
				await agentComposer.onStop();
				return;
			}
			if (agentSessionId) {
				await stopAgentSessionById(agentSessionId);
			}
		},
		[activeSessionId, agentComposer.onStop, stopAgentSessionById],
	);

	const requestActiveClose = useCallback(() => {
		closeGuard.requestClose({
			isRunning: agentComposer.isStreaming,
			onClose: sessionNavigation.closeActiveOrReset,
			onStop: agentComposer.onStop,
		});
	}, [
		closeGuard,
		agentComposer.isStreaming,
		agentComposer.onStop,
		sessionNavigation.closeActiveOrReset,
	]);
	useMenuCommand('tab.close', requestActiveClose);

	const requestTabClose = useCallback(
		(targetId: string) => {
			const target = resolveRunningCloseTarget({
				activeSessionId,
				isActiveStreaming: agentComposer.isStreaming,
				tabs: sessionNavigation.sessionTabs,
				targetId,
			});
			closeGuard.requestClose({
				isRunning: target.isRunning,
				onClose: () => sessionNavigation.closeSessionTab(targetId),
				onStop: stopFor(targetId, target.agentSessionId),
			});
		},
		[
			activeSessionId,
			closeGuard,
			agentComposer.isStreaming,
			sessionNavigation,
			stopFor,
		],
	);

	return {
		closeGuard,
		guardedSessionNavigation: useMemo(
			() => ({ ...sessionNavigation, closeSessionTab: requestTabClose }),
			[requestTabClose, sessionNavigation],
		),
	};
}
