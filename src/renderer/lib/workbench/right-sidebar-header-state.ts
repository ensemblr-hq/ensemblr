import { i18n } from '@/renderer/lib/i18n';
import type {
	RightSidebarHeaderState,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

/**
 * Label the header falls back to while an agent turn is in flight.
 * @returns The label in the active language.
 */
function agentWorkingLabel(): string {
	return i18n.t('workbench:sidebar-header.agent.working', 'Working...');
}

/**
 * The one name a conflicting branch goes by, resolved per call so a language
 * switch reaches it. Shares its key with the pull-request model, which reports
 * the conflicts `gh` returns, while the header also reports the ones the local
 * trial merge found first — so both routes to the same fact read identically.
 * @returns The label in the active language.
 */
function mergeConflictsLabel(): string {
	return i18n.t('git:pull-request.label.conflicts', 'Merge conflicts');
}

/** Options that adjust header derivation for signals outside the PR snapshot. */
interface RightSidebarHeaderStateOptions {
	/**
	 * Whether any agent attached to the workspace is mid-turn. Passed in by the
	 * caller rather than read from `workspace.status` so cached fixtures keep
	 * their PR-priority semantics, mirroring `getWorkspaceSidebarState`.
	 */
	agentBusy?: boolean;
	continuedPullRequestNumber?: number;
	/**
	 * Whether the local trial merge found conflicting paths. OR'd with GitHub's
	 * own verdict so the header, the Checks panel, and the Changes list never
	 * disagree about whether this branch merges — the trial merge sees a moved
	 * base before `gh` does, and answers even when no pull request exists.
	 */
	hasConflicts?: boolean;
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
 * @param options - Header state inputs that live outside the PR snapshot.
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
	const isAgentWorking =
		options.agentBusy === true || pullRequest.status === 'agent-working';
	const workingLabel = isAgentWorking ? agentWorkingLabel() : '';
	const hasConflicts =
		options.hasConflicts === true || pullRequest.isConflicting === true;

	const isDismissedMergedPullRequest =
		pullRequest.state === 'merged' &&
		options.continuedPullRequestNumber === pullRequestNumber;

	if (!hasPullRequestNumber || isDismissedMergedPullRequest) {
		return {
			hasConflicts,
			isAgentWorking,
			kind: hasBranchChanges ? 'create-pr' : 'empty',
			label: hasConflicts ? mergeConflictsLabel() : workingLabel,
			tone: hasConflicts ? 'blocked' : 'neutral',
		};
	}

	const variant = resolveNumberedHeaderVariant(pullRequest, hasConflicts);
	return {
		...variant,
		hasConflicts,
		isAgentWorking,
		label: variant.label || workingLabel,
		number: pullRequestNumber,
		previewDeployment: pullRequest.previewDeployment,
		url: pullRequest.url,
	};
}

/**
 * Maps a pull request onto the kind, label, and tone its header pill shows. Kept
 * separate from the state literal so every PR-linked branch is built once and a
 * new header field cannot be dropped from one status. Every label is a status,
 * blank when there is none to report; the header never shows the PR title, which
 * the number pill already links to.
 *
 * Local work the remote does not have outranks the PR's own status, because a
 * checks verdict against an unpublished tree is stale — but not a merged PR,
 * whose git state is no longer actionable from this header. A conflict sits just
 * below that local work, since the branch has to be committed before it can be
 * resolved, and above every checks-derived status, which it makes moot.
 *
 * @param pullRequest - Pull-request slice of the workspace model.
 * @param hasConflicts - Whether either conflict source found the branch unmergeable.
 * @returns The status-dependent parts of the header state.
 */
function resolveNumberedHeaderVariant(
	pullRequest: WorkspaceShellModel['pullRequest'],
	hasConflicts: boolean,
): NumberedHeaderVariant {
	if (pullRequest.state === 'merged') {
		return {
			kind: 'pr-merged',
			label:
				pullRequest.label ||
				i18n.t('workbench:sidebar-header.pr.merged', 'Merged'),
			tone: 'merged',
		};
	}

	const gitStatus = pullRequest.gitStatus;

	if (gitStatus.kind === 'uncommitted') {
		return { kind: 'pr-uncommitted', label: gitStatus.label, tone: 'pending' };
	}

	if (gitStatus.kind === 'unpublished' || gitStatus.kind === 'unpushed') {
		return { kind: 'pr-unpushed', label: gitStatus.label, tone: 'pending' };
	}

	if (hasConflicts) {
		return {
			kind: 'pr-blocked',
			label: mergeConflictsLabel(),
			tone: 'blocked',
		};
	}

	if (pullRequest.status === 'ready-to-merge') {
		return {
			kind: 'pr-ready',
			label:
				pullRequest.label ||
				i18n.t('workbench:sidebar-header.pr.ready', 'Ready to merge'),
			tone: 'ready',
		};
	}

	if (pullRequest.status === 'checking') {
		return { kind: 'pr-checking', label: pullRequest.label, tone: 'pending' };
	}

	if (pullRequest.status === 'blocked') {
		return { kind: 'pr-blocked', label: pullRequest.label, tone: 'blocked' };
	}

	return { kind: 'pr-open', label: pullRequest.label, tone: 'neutral' };
}
