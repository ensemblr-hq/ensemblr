import type {
	RightSidebarHeaderState,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

/**
 * Derives the right-sidebar header state (kind, label, tone, URL) from the
 * workspace's pull-request status.
 *
 * `hasBranchChanges` gates the Create PR action on the whole branch diff vs base
 * (committed-on-branch or uncommitted), so the action stays available after the
 * worktree is committed but before a PR exists. Defaults to the working-tree
 * count for callers that lack the branch-scoped read.
 */
export function getRightSidebarHeaderState(
	workspace: WorkspaceShellModel,
	hasBranchChanges: boolean = workspace.changeSummary.files > 0,
): RightSidebarHeaderState {
	const pullRequest = workspace.pullRequest;
	const pullRequestNumber = pullRequest.number;
	const hasPullRequestNumber = typeof pullRequestNumber === 'number';

	if (!hasPullRequestNumber) {
		return {
			kind: hasBranchChanges ? 'create-pr' : 'empty',
			tone: 'neutral',
		};
	}

	if (pullRequest.status === 'ready-to-merge') {
		return {
			kind: 'pr-ready',
			label: pullRequest.label || 'Ready to merge',
			number: pullRequestNumber,
			previewDeployment: pullRequest.previewDeployment,
			tone: 'ready',
			url: pullRequest.url,
		};
	}

	if (pullRequest.status === 'checking') {
		return {
			kind: 'pr-checking',
			label: pullRequest.label,
			number: pullRequestNumber,
			previewDeployment: pullRequest.previewDeployment,
			tone: 'pending',
			url: pullRequest.url,
		};
	}

	if (pullRequest.status === 'blocked') {
		return {
			kind: 'pr-blocked',
			label: pullRequest.label,
			number: pullRequestNumber,
			previewDeployment: pullRequest.previewDeployment,
			tone: 'blocked',
			url: pullRequest.url,
		};
	}

	if (pullRequest.status === 'agent-working') {
		return {
			kind: 'pr-working',
			label: 'Working...',
			number: pullRequestNumber,
			previewDeployment: pullRequest.previewDeployment,
			tone: 'neutral',
			url: pullRequest.url,
		};
	}

	return {
		kind: 'pr-open',
		label:
			pullRequest.label ||
			pullRequest.title ||
			`PR #${pullRequestNumber.toString()}`,
		number: pullRequestNumber,
		previewDeployment: pullRequest.previewDeployment,
		tone: 'neutral',
		url: pullRequest.url,
	};
}
