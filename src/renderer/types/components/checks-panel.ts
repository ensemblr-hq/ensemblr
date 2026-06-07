import type {
	PullRequestCheckStatus,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

export type ChecksPanelState =
	| {
			detail: string;
			hasPullRequest: false;
			kind: 'empty' | 'uncommitted';
			status: PullRequestCheckStatus | 'open';
			title: string;
	  }
	| {
			detail: string;
			hasPullRequest: true;
			kind:
				| 'pr-blocked'
				| 'pr-checking'
				| 'pr-open'
				| 'pr-ready'
				| 'pr-working';
			pullRequest: WorkspaceShellModel['pullRequest'];
			status: PullRequestCheckStatus | 'open';
			title: string;
	  };

export type ProviderMarkKind =
	| WorkspaceShellModel['pullRequest']['checks'][number]['provider']
	| WorkspaceShellModel['pullRequest']['comments'][number]['provider']
	| NonNullable<
			WorkspaceShellModel['pullRequest']['previewDeployment']
	  >['provider'];
