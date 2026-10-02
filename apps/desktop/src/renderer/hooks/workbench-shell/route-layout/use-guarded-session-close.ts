import { useAtomValue } from 'jotai';
import { useCallback, useMemo } from 'react';
import {
	type useAgentComposerController,
	useStopAgentSession,
} from '@/renderer/state/composer';
import { useMenuCommand } from '@/renderer/state/menu-commands';
import {
	claudeBackgroundTaskCountBySessionAtom,
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
 *
 * Both paths run the same refusal first, so a running sub-agent's tab cannot be
 * closed through ⌘W either — `SessionTab` withholds its close control for the
 * same reason, and an affordance hidden in one place and reachable through a
 * shortcut in the other is not a rule.
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
	const backgroundTaskCounts = useAtomValue(
		claudeBackgroundTaskCountBySessionAtom,
	);

	/**
	 * Background tasks a close target still has running. A chat whose turn ended
	 * but whose shell has not looks idle everywhere else, so without this the
	 * close would take the work away with no warning at all.
	 */
	const backgroundTasksOf = useCallback(
		(agentSessionId: string | null) =>
			agentSessionId ? (backgroundTaskCounts[agentSessionId] ?? 0) : 0,
		[backgroundTaskCounts],
	);

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

	/**
	 * Resolves one close attempt against the live composer flag, so both the ⌘W
	 * and tab-strip paths refuse and confirm on exactly the same reading.
	 */
	const resolveTarget = useCallback(
		(targetId: string) =>
			resolveRunningCloseTarget({
				activeSessionId,
				isActiveStreaming: agentComposer.isStreaming,
				tabs: sessionNavigation.sessionTabs,
				targetId,
			}),
		[activeSessionId, agentComposer.isStreaming, sessionNavigation.sessionTabs],
	);

	const requestActiveClose = useCallback(() => {
		const target = resolveTarget(activeSessionId);
		if (target.isRefused) {
			return;
		}
		closeGuard.requestClose({
			backgroundTaskCount: backgroundTasksOf(target.agentSessionId),
			isRunning: agentComposer.isStreaming,
			onClose: sessionNavigation.closeActiveOrReset,
			onStop: agentComposer.onStop,
		});
	}, [
		activeSessionId,
		backgroundTasksOf,
		closeGuard,
		agentComposer.isStreaming,
		agentComposer.onStop,
		resolveTarget,
		sessionNavigation.closeActiveOrReset,
	]);
	useMenuCommand('tab.close', requestActiveClose);

	const requestTabClose = useCallback(
		(targetId: string) => {
			const target = resolveTarget(targetId);
			if (target.isRefused) {
				return;
			}
			closeGuard.requestClose({
				backgroundTaskCount: backgroundTasksOf(target.agentSessionId),
				isRunning: target.isRunning,
				onClose: () => sessionNavigation.closeSessionTab(targetId),
				onStop: stopFor(targetId, target.agentSessionId),
			});
		},
		[backgroundTasksOf, closeGuard, resolveTarget, sessionNavigation, stopFor],
	);

	return {
		closeGuard,
		guardedSessionNavigation: useMemo(
			() => ({ ...sessionNavigation, closeSessionTab: requestTabClose }),
			[requestTabClose, sessionNavigation],
		),
	};
}
