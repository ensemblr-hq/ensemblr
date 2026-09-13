import {
	ArrowUpIcon,
	CircleEllipsisIcon,
	GitBranchIcon,
	GitMergeConflictIcon,
	GitMergeIcon,
	GitPullRequestArrowIcon,
	GitPullRequestIcon,
	LoaderCircleIcon,
} from 'lucide-react';

import type {
	WorkspaceLifecycleRun,
	WorkspaceSidebarState,
} from '@/renderer/types/components';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

import { hasUnsentLocalWork } from './pull-request-model';

/**
 * Derives the icon and tone for a workspace sidebar row from its status.
 *
 * A destructive lifecycle run outranks everything else the row could say: the
 * workspace is being torn down, so a pull-request verdict or an agent turn from
 * a moment ago describes a state it is leaving.
 * @param workspace - The workspace the row stands for
 * @param options - Live state the cached workspace snapshot does not carry
 * @returns The icon, tone, and state id the row renders from
 */
export function getWorkspaceSidebarState(
	workspace: WorkspaceShellModel,
	options: {
		agentBusy?: boolean;
		lifecycleRun?: WorkspaceLifecycleRun | null;
	} = {},
): WorkspaceSidebarState {
	if (options.lifecycleRun) {
		return {
			className: 'text-muted-foreground',
			icon: LoaderCircleIcon,
			isSpinning: true,
			kind:
				options.lifecycleRun === 'deleting'
					? 'workspace-deleting'
					: 'workspace-archiving',
		};
	}

	if (workspace.isPendingCreation) {
		return {
			className: 'text-muted-foreground',
			icon: LoaderCircleIcon,
			isSpinning: true,
			kind: 'workspace-working',
		};
	}

	// Live agent runtime activity takes top priority — the spinner is the most
	// informative signal when an agent session is mid-turn, even on workspaces
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

/**
 * PR-derived sidebar state, or `null` when no PR is attached to the workspace.
 *
 * Unsent local work displaces `pr-ready` only. GitHub computed that verdict
 * against the published tip, so on a branch holding work it has not seen the
 * verdict does not describe what merging would take — the same reason the
 * right-sidebar header puts `pr-uncommitted` and `pr-unpushed` above `pr-ready`.
 * A blocked or checking PR is not softened the same way: neither claims to be
 * mergeable, so the more urgent verdict stays on the row.
 *
 * How much the row knows depends on which model it came from. A live workspace
 * has both halves — its working-tree query answers for uncommitted edits and its
 * snapshot for unpushed commits. A cached navigation row has only the snapshot's
 * `branchSync`, so it reports unpushed commits and stays quiet about an
 * uncommitted edit until the workspace is opened.
 */
function getPullRequestSidebarState(
	workspace: WorkspaceShellModel,
): WorkspaceSidebarState | null {
	if (typeof workspace.pullRequest.number !== 'number') {
		return null;
	}

	// A merged PR is the terminal state — it beats any stale check/mergeability
	// status still hanging off the snapshot.
	if (workspace.pullRequest.state === 'merged') {
		return {
			className: 'text-status-merged',
			icon: GitMergeIcon,
			kind: 'pr-merged',
		};
	}

	if (workspace.pullRequest.status === 'ready-to-merge') {
		if (hasUnsentLocalWork(workspace.pullRequest.gitStatus)) {
			return {
				className: 'text-status-warning',
				icon: ArrowUpIcon,
				kind: 'pr-unpushed',
			};
		}
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
