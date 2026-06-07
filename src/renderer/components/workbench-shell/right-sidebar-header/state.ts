import type { WorkspaceShellModel } from '@/renderer/types/workbench';

import type { PullRequestHeaderTone } from './pull-request-number-button';

export type RightSidebarHeaderState =
	| {
			kind: 'create-pr' | 'empty';
			tone: PullRequestHeaderTone;
	  }
	| {
			kind:
				| 'pr-blocked'
				| 'pr-checking'
				| 'pr-open'
				| 'pr-ready'
				| 'pr-working';
			label: string;
			number: number;
			previewDeployment?: WorkspaceShellModel['pullRequest']['previewDeployment'];
			tone: PullRequestHeaderTone;
			url?: string;
	  };

/**
 * Derives the right-sidebar header state (kind, label, tone, URL) from the
 * workspace's pull-request status.
 */
export function getRightSidebarHeaderState(
	workspace: WorkspaceShellModel,
): RightSidebarHeaderState {
	const pullRequest = workspace.pullRequest;
	const pullRequestNumber = pullRequest.number;
	const hasPullRequestNumber = typeof pullRequestNumber === 'number';

	if (!hasPullRequestNumber) {
		return {
			kind: workspace.changeSummary.files > 0 ? 'create-pr' : 'empty',
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
