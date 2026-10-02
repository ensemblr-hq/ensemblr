import { atom } from 'jotai';
import { selectAtom } from 'jotai/utils';
import { atomFamily } from 'jotai-family';
import { agentConversationLiveStateAtom } from '@/renderer/state/agents/atoms';
import {
	activeBackgroundTasks,
	countActiveBackgroundTasks,
} from '@/shared/claude-background-tasks';
import type { AgentBackgroundTaskWire } from '@/shared/ipc/contracts/agent-session';

/**
 * Live background-task count keyed by workspace id, rolled up from every open
 * session's own projection. A workspace whose agent is idle still reports a
 * count while a background shell or async subagent it launched keeps running —
 * that gap between "the chat is idle" and "work is still going" is the whole
 * reason this exists. Workspaces with nothing live are absent, so a reader takes
 * the count with a `?? 0`.
 */
export const claudeBackgroundTasksByWorkspaceAtom = atom((get) => {
	const counts: Record<string, number> = {};
	for (const [workspaceId, sessions] of Object.entries(
		get(agentConversationLiveStateAtom),
	)) {
		let total = 0;
		for (const session of Object.values(sessions)) {
			total += countActiveBackgroundTasks(session.claudeBackgroundTasks);
		}
		if (total > 0) {
			counts[workspaceId] = total;
		}
	}
	return counts;
});

/**
 * One workspace's live background-task count. A sidebar row watches its own
 * slice, so a task launched or resolved in another workspace re-renders only
 * that workspace's row.
 */
export const claudeBackgroundTaskCountByWorkspaceAtomFamily = atomFamily(
	(workspaceId: string) =>
		selectAtom(
			claudeBackgroundTasksByWorkspaceAtom,
			(counts) => counts[workspaceId] ?? 0,
		),
);

/**
 * Live background-task count keyed by chat session id, across every workspace.
 * The close guard reads the whole map once rather than a slice per tab: it has
 * to answer for whichever tab the user just aimed a close at, and that target is
 * only known inside the callback where a hook cannot run.
 */
export const claudeBackgroundTaskCountBySessionAtom = atom((get) => {
	const counts: Record<string, number> = {};
	for (const sessions of Object.values(get(agentConversationLiveStateAtom))) {
		for (const [sessionId, session] of Object.entries(sessions)) {
			const count = countActiveBackgroundTasks(session.claudeBackgroundTasks);
			if (count > 0) {
				counts[sessionId] = count;
			}
		}
	}
	return counts;
});

const NO_TASKS: readonly AgentBackgroundTaskWire[] = [];

/**
 * The live background tasks of one chat session, for the notice the composer
 * shows above its editor. Keyed by session rather than workspace because the
 * notice names what *this* conversation left running, which is the thing a user
 * about to close the tab needs to see.
 */
export const claudeBackgroundTasksBySessionAtomFamily = atomFamily(
	(agentSessionId: string) =>
		selectAtom(
			agentConversationLiveStateAtom,
			(byWorkspace) => {
				for (const sessions of Object.values(byWorkspace)) {
					const session = sessions[agentSessionId];
					if (session) {
						return activeBackgroundTasks(session.claudeBackgroundTasks);
					}
				}
				return NO_TASKS;
			},
			(left, right) =>
				left.length === right.length &&
				left.every((task, index) => task.taskId === right[index]?.taskId),
		),
);
