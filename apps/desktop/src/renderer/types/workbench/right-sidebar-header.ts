import type { WorkspaceShellModel } from './workspace';

/** Visual tone of the PR header pill, keyed to review and merge status. */
export type PullRequestHeaderTone =
	| 'blocked'
	| 'merged'
	| 'neutral'
	| 'pending'
	| 'ready';

/**
 * Discriminated header state for the right review sidebar, derived from a
 * workspace's pull-request status. `isAgentWorking` and `hasConflicts` ride
 * alongside every kind rather than being kinds of their own: an agent turn
 * freezes the header's actions, and a conflict qualifies the status, without
 * either erasing what the header is reporting. `hasConflicts` is on both members
 * because a branch can conflict before any pull request exists.
 */
export type RightSidebarHeaderState =
	| {
			hasConflicts: boolean;
			isAgentWorking: boolean;
			kind: 'create-pr' | 'empty';
			label: string;
			tone: PullRequestHeaderTone;
	  }
	| {
			hasConflicts: boolean;
			isAgentWorking: boolean;
			kind:
				| 'pr-blocked'
				| 'pr-checking'
				| 'pr-merged'
				| 'pr-open'
				| 'pr-ready'
				| 'pr-uncommitted'
				| 'pr-unpushed';
			label: string;
			number: number;
			previewDeployment?: WorkspaceShellModel['pullRequest']['previewDeployment'];
			tone: PullRequestHeaderTone;
			url?: string;
	  };
