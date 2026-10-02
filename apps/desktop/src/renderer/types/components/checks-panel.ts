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

/** Which of the git-status section's two actions the checks panel offers. */
export interface ChecksGitStatusSection {
	/** Offers the row's own action — "Commit and push", "Push branch", or "Push". */
	showCommitAction: boolean;
	/** Offers "Update PR" beside the section heading. */
	showUpdateAction: boolean;
}

export type ProviderMarkKind =
	| WorkspaceShellModel['pullRequest']['checks'][number]['provider']
	| WorkspaceShellModel['pullRequest']['comments'][number]['provider']
	| NonNullable<
			WorkspaceShellModel['pullRequest']['previewDeployment']
	  >['provider'];
