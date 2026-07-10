import type { WorkspaceShellModel } from './workspace';

/** Visual tone of the PR header pill, keyed to review and merge status. */
export type PullRequestHeaderTone = 'blocked' | 'neutral' | 'pending' | 'ready';

/** Discriminated header state for the right review sidebar, derived from a workspace's pull-request status. */
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
