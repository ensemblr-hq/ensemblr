import { formatCount } from '@/renderer/lib/format';
import type { ChecksPanelState } from '@/renderer/types/components';
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
				detail: `${formatCount(
					workspace.changeSummary.files,
					'uncommitted change',
				)} ready for PR setup.`,
				hasPullRequest: false,
				kind: 'uncommitted',
				status: 'pending',
				title: 'No pull request',
			};
		}

		return {
			detail: 'No local changes to review.',
			hasPullRequest: false,
			kind: 'empty',
			status: 'open',
			title: 'No pull request',
		};
	}

	if (pullRequest.status === 'ready-to-merge') {
		return {
			detail: pullRequest.detail || 'All required checks passed.',
			hasPullRequest: true,
			kind: 'pr-ready',
			pullRequest,
			status: 'ready',
			title: pullRequest.label || 'Ready to merge',
		};
	}

	if (pullRequest.status === 'checking') {
		return {
			detail: pullRequest.detail || 'Checks are still running.',
			hasPullRequest: true,
			kind: 'pr-checking',
			pullRequest,
			status: 'pending',
			title: pullRequest.label || 'Checks pending',
		};
	}

	if (pullRequest.status === 'blocked') {
		return {
			detail: pullRequest.detail || 'Resolve blockers before merge.',
			hasPullRequest: true,
			kind: 'pr-blocked',
			pullRequest,
			status: 'blocked',
			title: pullRequest.label || 'Checks failed',
		};
	}

	if (pullRequest.status === 'agent-working') {
		return {
			detail: pullRequest.detail || 'The agent is updating this workspace.',
			hasPullRequest: true,
			kind: 'pr-working',
			pullRequest,
			status: 'pending',
			title: 'Pull request active',
		};
	}

	return {
		detail: pullRequest.detail || 'Pull request is open.',
		hasPullRequest: true,
		kind: 'pr-open',
		pullRequest,
		status: 'open',
		title:
			pullRequest.label ||
			pullRequest.title ||
			`Pull request #${pullRequest.number}`,
	};
}
