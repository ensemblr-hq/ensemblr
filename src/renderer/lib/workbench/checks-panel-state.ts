import { i18n } from '@/renderer/lib/i18n';
import type {
	ChecksGitStatusSection,
	ChecksPanelState,
} from '@/renderer/types/components';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

/** Derives the checks-panel summary state from the workspace + PR. */
export function getChecksPanelState(
	workspace: WorkspaceShellModel,
): ChecksPanelState {
	const { pullRequest } = workspace;
	const hasPullRequest = typeof pullRequest.number === 'number';

	if (!hasPullRequest) {
		if (workspace.changeSummary.files > 0) {
			return {
				detail: i18n.t('workbench:checks-panel.uncommitted.detail', {
					count: workspace.changeSummary.files,
					defaultValue_one: '{{count}} uncommitted change ready for PR setup.',
					defaultValue_other:
						'{{count}} uncommitted changes ready for PR setup.',
				}),
				hasPullRequest: false,
				kind: 'uncommitted',
				status: 'pending',
				title: i18n.t(
					'workbench:checks-panel.no-pull-request.title',
					'No pull request',
				),
			};
		}

		return {
			detail: i18n.t(
				'workbench:checks-panel.empty.detail',
				'No local changes to review.',
			),
			hasPullRequest: false,
			kind: 'empty',
			status: 'open',
			title: i18n.t(
				'workbench:checks-panel.no-pull-request.title',
				'No pull request',
			),
		};
	}

	if (pullRequest.status === 'ready-to-merge') {
		return {
			detail:
				pullRequest.detail ||
				i18n.t(
					'workbench:checks-panel.ready.detail',
					'All required checks passed.',
				),
			hasPullRequest: true,
			kind: 'pr-ready',
			pullRequest,
			status: 'ready',
			title:
				pullRequest.label ||
				i18n.t('workbench:checks-panel.ready.title', 'Ready to merge'),
		};
	}

	if (pullRequest.status === 'checking') {
		return {
			detail:
				pullRequest.detail ||
				i18n.t(
					'workbench:checks-panel.checking.detail',
					'Checks are still running.',
				),
			hasPullRequest: true,
			kind: 'pr-checking',
			pullRequest,
			status: 'pending',
			title:
				pullRequest.label ||
				i18n.t('workbench:checks-panel.checking.title', 'Checks pending'),
		};
	}

	if (pullRequest.status === 'blocked') {
		return {
			detail:
				pullRequest.detail ||
				i18n.t(
					'workbench:checks-panel.blocked.detail',
					'Resolve blockers before merge.',
				),
			hasPullRequest: true,
			kind: 'pr-blocked',
			pullRequest,
			status: 'blocked',
			title:
				pullRequest.label ||
				i18n.t('workbench:checks-panel.blocked.title', 'Checks failed'),
		};
	}

	if (pullRequest.status === 'agent-working') {
		return {
			detail:
				pullRequest.detail ||
				i18n.t(
					'workbench:checks-panel.working.detail',
					'The agent is updating this workspace.',
				),
			hasPullRequest: true,
			kind: 'pr-working',
			pullRequest,
			status: 'pending',
			title: i18n.t(
				'workbench:checks-panel.working.title',
				'Pull request active',
			),
		};
	}

	return {
		detail:
			pullRequest.detail ||
			i18n.t('workbench:checks-panel.open.detail', 'Pull request is open.'),
		hasPullRequest: true,
		kind: 'pr-open',
		pullRequest,
		status: 'open',
		title:
			pullRequest.label ||
			pullRequest.title ||
			i18n.t('workbench:checks-panel.open.title', 'Pull request #{{number}}', {
				number: pullRequest.number,
			}),
	};
}

/**
 * Decides whether the checks panel renders its git-status section, and which of
 * the section's two actions it offers. Work the remote does not have — whether
 * uncommitted, unpublished, or unpushed — keeps the section alive even on a
 * ready-to-merge or already-merged PR, because that work still needs its way out
 * of the worktree. Only a clean worktree drops the section's own action, and a
 * closed or merged PR is past the point where "Update PR" means anything.
 * @param state - Resolved checks-panel state for a workspace that has a PR.
 * @returns The section's available actions, or null when there is nothing to show.
 */
export function resolveGitStatusSection(
	state: Extract<ChecksPanelState, { hasPullRequest: true }>,
): ChecksGitStatusSection | null {
	const { pullRequest } = state;
	const isClosedOrMerged =
		pullRequest.state === 'merged' || pullRequest.state === 'closed';
	const hasUnsentLocalWork = pullRequest.gitStatus.kind !== 'clean';

	if (isClosedOrMerged && !hasUnsentLocalWork) {
		return null;
	}

	return {
		showCommitAction: state.kind !== 'pr-ready' || hasUnsentLocalWork,
		showUpdateAction: !isClosedOrMerged,
	};
}
