import { useQuery } from '@tanstack/react-query';
import { useAtomValue } from 'jotai';
import { selectAtom } from 'jotai/utils';
import { useMemo } from 'react';

import { workspaceGitStatusQuery } from '@/renderer/api/ensemblr-queries';
import { useLivePullRequestModel } from '@/renderer/hooks/workbench-shell/route-layout/use-live-pull-request-model';
import { useWorkspaceBusy } from '@/renderer/hooks/workspace/use-workspace-busy';
import { getWorkspaceSidebarState } from '@/renderer/lib/workbench';
import { useWorkspaceUnreadCount } from '@/renderer/state/unread';
import {
	claudeBackgroundTaskCountByWorkspaceAtomFamily,
	useWorkspaceIsUnread,
	useWorkspaceLifecycleRun,
	type WorkspaceDockActivityState,
	workspaceDockActivityByWorkspaceAtom,
} from '@/renderer/state/workspace';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

/** Stands in for the working-tree counts an inactive row does not fetch. */
const NO_WORKTREE_CHANGES = { additions: 0, deletions: 0, files: 0 } as const;

/**
 * Live row state for one workspace in the navigation sidebar: its unread flag,
 * the state icon resolved against live agent and pull-request activity, whether
 * it has diff stats to show, and the dock-activity dot.
 *
 * The active row shares the header's live PR snapshot (same query key), so its
 * icon flips to ready-to-merge in the same render as the header rather than one
 * navigation poll later. Only the active row *fetches* that snapshot; an inactive
 * one still reads the copy it already holds, and the status it renders is
 * whichever of that copy and the navigation poll's observed GitHub last — so
 * leaving a workspace cannot walk its icon back to a status the poll has not
 * caught up to yet. Agent runtime activity flows through `agentBusy` so it takes
 * spinner priority without disturbing cached `workspace.status` semantics.
 *
 * The PR model's git-status row is built from the *working-tree* counts, which
 * only the active row fetches — and it shares the route layout's query key, so
 * reading them here costs no extra git call. `workspace.changeSummary` is not a
 * substitute: navigation fills it from a `baseRef..HEAD` diff, so every commit on
 * the branch would read as an uncommitted edit and no PR row could ever be clean.
 * An inactive row reports what its cached `branchSync` knows (unpushed commits)
 * and stays quiet about the worktree.
 *
 * Dock activity is uniform across rows: it comes from the app-wide terminal
 * activity the workbench frame watches, not from this workspace's dock, which
 * only exists while its route is mounted.
 *
 * `isUnread` comes from `useWorkspaceIsUnread`, which folds the manual flag and
 * the per-chat marks; the bold label answers either, while only the chat count
 * draws the dot.
 *
 * `lifecycleRun` is the one piece of row state the cached workspace cannot
 * carry: an archive or a delete is a renderer-side run against a workspace the
 * list still holds. It takes the icon outright and the row renders itself
 * non-interactive from it.
 * @param isActive - Whether this row is the workspace currently open
 * @param workspace - The workspace the row stands for
 * @returns The derived state the row renders from
 */
export function useWorkspaceSidebarRow({
	isActive,
	workspace,
}: {
	isActive: boolean;
	workspace: WorkspaceShellModel;
}) {
	const isUnread = useWorkspaceIsUnread(workspace.id);
	const unreadCount = useWorkspaceUnreadCount(workspace.id);
	const agentBusy = useWorkspaceBusy(workspace.id);
	const lifecycleRun = useWorkspaceLifecycleRun(workspace.id);
	const { data: worktreeStatusData } = useQuery(
		workspaceGitStatusQuery(isActive ? workspace.pathLabel : null),
	);
	const worktreeChangeSummary =
		worktreeStatusData && !worktreeStatusData.error
			? worktreeStatusData.summary
			: NO_WORKTREE_CHANGES;
	const livePullRequest = useLivePullRequestModel({
		changeSummary: worktreeChangeSummary,
		enabled: isActive,
		fallback: workspace.pullRequest,
		workspaceCwd: workspace.pathLabel,
		workspaceId: workspace.id,
	});
	const liveDockActivityAtom = useMemo(
		() =>
			selectAtom(
				workspaceDockActivityByWorkspaceAtom,
				(activity: Record<string, WorkspaceDockActivityState>) =>
					activity[workspace.id] ?? null,
			),
		[workspace.id],
	);
	const dockActivityState = useAtomValue(liveDockActivityAtom);
	const claudeBackgroundTaskCount = useAtomValue(
		claudeBackgroundTaskCountByWorkspaceAtomFamily(workspace.id),
	);

	const liveWorkspace =
		livePullRequest === workspace.pullRequest
			? workspace
			: { ...workspace, pullRequest: livePullRequest };

	return {
		claudeBackgroundTaskCount,
		dockActivityState,
		hasDiffStats:
			workspace.changeSummary.additions > 0 ||
			workspace.changeSummary.deletions > 0,
		isUnread,
		lifecycleRun,
		sidebarState: getWorkspaceSidebarState(liveWorkspace, {
			agentBusy,
			lifecycleRun,
		}),
		unreadCount,
	};
}
