import { atom } from 'jotai';
import { selectAtom } from 'jotai/utils';
import { atomFamily } from 'jotai-family';
import { agentConversationLiveStateAtom } from '@/renderer/state/agents/atoms';

/**
 * Live Claude Code background-task count keyed by workspace id. Rolls up every
 * open session's own live-task set — the projection each session's
 * {@link agentConversationLiveStateAtom} entry carries — so a workspace whose
 * agent is idle still lights the sidebar dot while a background bash or an
 * async subagent it launched keeps running. Workspaces with no live task are
 * absent from the map, so the sidebar row can read the count off a `?? 0`.
 */
export const claudeBackgroundTasksByWorkspaceAtom = atom((get) => {
	const counts: Record<string, number> = {};
	const byWorkspace = get(agentConversationLiveStateAtom);
	for (const [workspaceId, sessions] of Object.entries(byWorkspace)) {
		let total = 0;
		for (const session of Object.values(sessions)) {
			total += session.claudeBackgroundTasks.liveTaskIds.size;
		}
		if (total > 0) {
			counts[workspaceId] = total;
		}
	}
	return counts;
});

/**
 * One workspace's Claude Code background-task count. A sidebar row watches its
 * own slice rather than the whole map, so a task launched or resolved in
 * another workspace re-renders only that workspace's row.
 */
export const claudeBackgroundTaskCountByWorkspaceAtomFamily = atomFamily(
	(workspaceId: string) =>
		selectAtom(
			claudeBackgroundTasksByWorkspaceAtom,
			(counts) => counts[workspaceId] ?? 0,
		),
);
