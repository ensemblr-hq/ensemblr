export type PullRequestShellStatus =
	| 'agent-working'
	| 'blocked'
	| 'checking'
	| 'idle'
	| 'ready-to-merge';

export type PullRequestCheckStatus = 'blocked' | 'pending' | 'ready';

export interface PullRequestCheckSummary {
	durationLabel?: string;
	id: string;
	label: string;
	provider: 'github' | 'local' | 'vercel';
	status: PullRequestCheckStatus;
	url?: string;
}

export interface PullRequestCommentSummary {
	detail: string;
	id: string;
	provider: 'github-actions' | 'linear';
}

export interface PullRequestTodoSummary {
	id: string;
	label: string;
}

export interface PullRequestPreviewDeploymentSummary {
	label: string;
	provider: 'netlify' | 'unknown' | 'vercel';
	source: 'check-link' | 'github-deployment' | 'pr-comment';
	status: PullRequestCheckStatus;
	url: string;
}

export interface PullRequestGitStatusSummary {
	actionLabel?: string;
	label: string;
	status: PullRequestCheckStatus | 'open';
}
