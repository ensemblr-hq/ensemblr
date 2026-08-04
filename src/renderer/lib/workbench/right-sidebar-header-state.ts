import type {
	RightSidebarHeaderState,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

/** Options that adjust header derivation for user-dismissed terminal PR states. */
interface RightSidebarHeaderStateOptions {
	continuedPullRequestNumber?: number;
}

/** The parts of a PR-linked header state that vary with pull-request status. */
type NumberedHeaderVariant = Pick<
	Extract<RightSidebarHeaderState, { number: number }>,
	'kind' | 'label' | 'tone'
>;

/**
 * Derives the right-sidebar header state (kind, label, tone, URL) from the
 * workspace's pull-request status.
 *
 * `hasBranchChanges` gates the Create PR action on the whole branch diff vs base
 * (committed-on-branch or uncommitted), so the action stays available after the
 * worktree is committed but before a PR exists. Defaults to the working-tree
 * count for callers that lack the branch-scoped read.
 *
 * @param workspace - Workspace model containing pull-request and branch state.
 * @param hasBranchChanges - Whether the branch diff has reviewable changes.
 * @param options - User-local header state overrides.
 * @returns The header state consumed by the review sidebar shell.
 */
export function getRightSidebarHeaderState(
	workspace: WorkspaceShellModel,
	hasBranchChanges: boolean = workspace.changeSummary.files > 0,
	options: RightSidebarHeaderStateOptions = {},
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

	if (
		pullRequest.state === 'merged' &&
		options.continuedPullRequestNumber === pullRequestNumber
	) {
		return {
			kind: hasBranchChanges ? 'create-pr' : 'empty',
			tone: 'neutral',
		};
	}

	return {
		...resolveNumberedHeaderVariant(pullRequest, pullRequestNumber),
		number: pullRequestNumber,
		previewDeployment: pullRequest.previewDeployment,
		url: pullRequest.url,
	};
}

/**
 * Maps a pull request onto the kind, label, and tone its header pill shows. Kept
 * separate from the state literal so every PR-linked branch is built once and a
 * new header field cannot be dropped from one status.
 * @param pullRequest - Pull-request slice of the workspace model.
 * @param pullRequestNumber - PR number used as the last-resort label.
 * @returns The status-dependent parts of the header state.
 */
function resolveNumberedHeaderVariant(
	pullRequest: WorkspaceShellModel['pullRequest'],
	pullRequestNumber: number,
): NumberedHeaderVariant {
	if (pullRequest.state === 'merged') {
		return {
			kind: 'pr-merged',
			label: pullRequest.label || 'Merged',
			tone: 'merged',
		};
	}

	if (pullRequest.status === 'ready-to-merge') {
		return {
			kind: 'pr-ready',
			label: pullRequest.label || 'Ready to merge',
			tone: 'ready',
		};
	}

	if (pullRequest.status === 'checking') {
		return { kind: 'pr-checking', label: pullRequest.label, tone: 'pending' };
	}

	if (pullRequest.status === 'blocked') {
		return { kind: 'pr-blocked', label: pullRequest.label, tone: 'blocked' };
	}

	if (pullRequest.status === 'agent-working') {
		return { kind: 'pr-working', label: 'Working...', tone: 'neutral' };
	}

	return {
		kind: 'pr-open',
		label:
			pullRequest.label ||
			pullRequest.title ||
			`PR #${pullRequestNumber.toString()}`,
		tone: 'neutral',
	};
}
