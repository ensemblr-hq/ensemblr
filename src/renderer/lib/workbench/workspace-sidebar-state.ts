import {
	CircleEllipsisIcon,
	GitBranchIcon,
	GitMergeConflictIcon,
	GitPullRequestArrowIcon,
	GitPullRequestIcon,
	LoaderCircleIcon,
} from 'lucide-react';

import type { WorkspaceSidebarState } from '@/renderer/types/components';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

/** Derives the icon and tone for a workspace sidebar row from its status. */
export function getWorkspaceSidebarState(
	workspace: WorkspaceShellModel,
	options: { agentBusy?: boolean } = {},
): WorkspaceSidebarState {
	// Live Pi runtime activity takes top priority — the spinner is the most
	// informative signal when a Pi session is mid-turn, even on workspaces
	// with an open PR or pending checks. The flag is passed in by the caller
	// instead of being derived from `workspace.status` so PR-priority
	// semantics on cached fixtures stay intact.
	if (options.agentBusy) {
		return {
			className: 'text-muted-foreground',
			icon: LoaderCircleIcon,
			isSpinning: true,
			kind: 'workspace-working',
		};
	}

	const pullRequestState = getPullRequestSidebarState(workspace);

	if (pullRequestState) {
		return pullRequestState;
	}

	if (workspace.checks.status === 'blocked') {
		return {
			className: 'text-status-danger',
			icon: GitMergeConflictIcon,
			kind: 'workspace-blocked',
		};
	}

	if (workspace.status === 'working') {
		return {
			className: 'text-muted-foreground',
			icon: LoaderCircleIcon,
			isSpinning: true,
			kind: 'workspace-working',
		};
	}

	if (workspace.checks.status === 'pending') {
		return {
			className: 'text-status-warning',
			icon: CircleEllipsisIcon,
			kind: 'workspace-checking',
		};
	}

	return {
		className: 'text-muted-foreground',
		icon: GitBranchIcon,
		kind: 'branch',
	};
}

/** PR-derived sidebar state, or `null` when no PR is attached to the workspace. */
function getPullRequestSidebarState(
	workspace: WorkspaceShellModel,
): WorkspaceSidebarState | null {
	if (typeof workspace.pullRequest.number !== 'number') {
		return null;
	}

	if (workspace.pullRequest.status === 'ready-to-merge') {
		return {
			className: 'text-status-ok',
			icon: GitPullRequestArrowIcon,
			kind: 'pr-ready',
		};
	}

	if (workspace.pullRequest.status === 'checking') {
		return {
			className: 'text-status-warning',
			icon: CircleEllipsisIcon,
			kind: 'pr-checking',
		};
	}

	if (workspace.pullRequest.status === 'blocked') {
		return {
			className: 'text-status-danger',
			icon: GitMergeConflictIcon,
			kind: 'pr-blocked',
		};
	}

	if (workspace.pullRequest.status === 'agent-working') {
		return {
			className: 'text-muted-foreground',
			icon: LoaderCircleIcon,
			isSpinning: true,
			kind: 'pr-working',
		};
	}

	return {
		className: 'text-muted-foreground',
		icon: GitPullRequestIcon,
		kind: 'pr-open',
	};
}
