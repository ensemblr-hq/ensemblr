import { useAtomValue } from 'jotai';
import { selectAtom } from 'jotai/utils';
import { useMemo } from 'react';

import { useLivePullRequestModel } from '@/renderer/hooks/workbench-shell/route-layout/use-live-pull-request-model';
import { useWorkspaceBusy } from '@/renderer/hooks/workspace/use-workspace-busy';
import { getWorkspaceSidebarState } from '@/renderer/lib/workbench';
import {
	getRunningDockActivityState,
	useWorkspaceUnread,
	type WorkspaceDockActivityState,
	workspaceDockActivityByWorkspaceAtom,
} from '@/renderer/state/workspace';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

/**
 * Live row state for one workspace in the navigation sidebar: its unread flag,
 * the state icon resolved against live agent and pull-request activity, whether
 * it has diff stats to show, and the dock-activity dot.
 *
 * The active row shares the header's live PR snapshot (same query key), so its
 * icon flips to ready-to-merge in the same render as the header rather than one
 * navigation poll later. Inactive rows keep the navigation snapshot's PR state,
 * which adds no subscriptions or re-renders — so the dot's freshness is not
 * uniform across rows. Agent runtime activity flows through `agentBusy` so it
 * takes spinner priority without disturbing cached `workspace.status` semantics.
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
	const isUnread = useWorkspaceUnread(workspace.id);
	const agentBusy = useWorkspaceBusy(workspace.id);
	const livePullRequest = useLivePullRequestModel({
		changeSummary: workspace.changeSummary,
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
	const liveDockActivityState = useAtomValue(liveDockActivityAtom);

	const liveWorkspace =
		livePullRequest === workspace.pullRequest
			? workspace
			: { ...workspace, pullRequest: livePullRequest };

	return {
		dockActivityState:
			liveDockActivityState ?? getRunningDockActivityState(workspace.dockTabs),
		hasDiffStats:
			workspace.changeSummary.additions > 0 ||
			workspace.changeSummary.deletions > 0,
		isUnread,
		sidebarState: getWorkspaceSidebarState(liveWorkspace, { agentBusy }),
	};
}
