/**
 * Outcomes of merging a workspace's pull request, shared by the main-process
 * merge close-out and the agent-control op that reports them back to an agent.
 */

import type { GithubFailure } from './ipc/contracts/github.ts';

/**
 * What became of the local copy of a merged workspace's base branch. Only a
 * fast-forward ever moves it: a branch with commits of its own reads as
 * `diverged`, and one checked out in another worktree is left for whoever works
 * there.
 */
export type LocalBaseSyncOutcome =
	| { branch: string; from: string; status: 'fast-forwarded'; to: string }
	| { branch: string; status: 'up-to-date' }
	| { branch: string; status: 'diverged'; upstreamRef: string }
	| { branch: string; status: 'no-local-branch' }
	| { branch: string; status: 'no-upstream' }
	| { branch: string; status: 'fetch-failed'; upstreamRef: string }
	| { branch: string; status: 'checked-out-elsewhere'; worktreePath: string }
	| { branch: string; detail: string; status: 'blocked' }
	| { status: 'disabled' }
	| { detail: string; status: 'unavailable' };

/** What became of the issue a merged workspace was created from. */
export type LinkedIssueCloseOutStatus =
	| 'already-closed'
	| 'closed'
	| 'failed'
	| 'no-linked-issue';

/**
 * The result of merging a workspace's pull request from inside the app. `queued`
 * means `gh pr merge` succeeded without the pull request reading as merged yet —
 * a merge queue took it — so the close-out waits for a later refresh to see it.
 */
export type WorkspaceMergeOutcome =
	| {
			baseSync: LocalBaseSyncOutcome;
			issue: LinkedIssueCloseOutStatus;
			pullRequestNumber: number;
			status: 'merged';
	  }
	| { status: 'queued' }
	| { failure: GithubFailure; status: 'failed' };
