/**
 * Wire contracts for the "Create workspace from source" picker: branches, pull
 * requests, and GitHub issues for a single repository. All three come from the
 * authenticated `gh` CLI run inside the repository path (ADR 0013 — no app-owned
 * OAuth): branches via `gh api graphql` (remote refs, so branches deleted/merged
 * on GitHub never linger like stale local refs), PRs and issues via
 * `gh pr/issue list`. All three are degradable: a failure surfaces an empty list
 * plus a typed error so the picker stays usable. Pull requests are limited to
 * same-repo heads (see {@link RepositoryPullRequestWire}).
 */

import type { GithubFailure } from './github';

/**
 * A branch that currently exists on the GitHub remote (sourced live via `gh`,
 * so branches deleted/merged on GitHub never linger like stale local refs).
 */
export interface RepositoryBranchWire {
	/** True when another active workspace already tracks this branch. */
	hasWorkspace: boolean;
	/** True for the repository's default branch; pinned to the top of the list. */
	isDefault: boolean;
	/** Bare branch name, e.g. `master` or `octocat/feature-x`. */
	name: string;
	/** Id of the active workspace tracking this branch when {@link hasWorkspace}. */
	workspaceId: string | null;
}

/**
 * An open pull request offered as a workspace source. Limited to same-repo PRs:
 * a workspace checks {@link headRefName} out and pushes back to it, which only
 * works when the head lives on the origin remote, so {@link isCrossRepository}
 * PRs are filtered out before they reach the picker.
 */
export interface RepositoryPullRequestWire {
	authorLogin: string | null;
	/** Branch the PR merges into; becomes the workspace's target branch. */
	baseRefName: string;
	/** True when another active workspace already holds {@link headRefName}. */
	hasWorkspace: boolean;
	/** Head branch name; the new workspace checks this branch out and owns it. */
	headRefName: string;
	/** True when the head lives on a fork; such PRs cannot be checked out locally. */
	isCrossRepository: boolean;
	isDraft: boolean;
	number: number;
	state: string;
	title: string;
	updatedAt: string;
	url: string;
	/** Id of the active workspace holding the head branch when {@link hasWorkspace}. */
	workspaceId: string | null;
}

/** A GitHub issue offered as a workspace source. */
export interface RepositoryIssueWire {
	/**
	 * Logins of everyone assigned to the issue. Empty means unassigned, which is
	 * what the dashboard board treats as backlog. The list is narrowed to
	 * unassigned issues by `gh issue list --search 'no:assignee'` before it is
	 * cached, so this is empty for every row the board reads; it stays on the wire
	 * because the create-from picker shows assignees on its own unfiltered list.
	 */
	assigneeLogins: string[];
	authorLogin: string | null;
	/** Raw issue body markdown; seeds the first-prompt composer draft. */
	body: string;
	labels: string[];
	number: number;
	state: string;
	title: string;
	updatedAt: string;
	url: string;
}

/** Request to list a repository's remote branches. */
export interface ListRepositoryBranchesRequest {
	repositoryId: string;
}

/** Request to list a repository's open pull requests. */
export interface ListRepositoryPullRequestsRequest {
	repositoryId: string;
}

/**
 * Request to list a repository's issues. Issues are cached in SQLite between
 * runs, so an ordinary call may answer from that cache; `refresh` skips it.
 */
export interface ListRepositoryIssuesRequest {
	/** Forces a fresh `gh issue list` and rewrites the cache with the result. */
	refresh?: boolean;
	repositoryId: string;
	/**
	 * Narrows the list to unassigned issues, which is the dashboard board's
	 * backlog. Applied by `gh` rather than after the fact, because `--limit`
	 * counts rows GitHub returns. The two variants cache separately.
	 */
	unassignedOnly?: boolean;
}

/** The repository's branches, or an empty list with a typed error when `gh` fails. */
export type ListRepositoryBranchesResult =
	| { branches: RepositoryBranchWire[]; status: 'ok' }
	| { branches: RepositoryBranchWire[]; error: GithubFailure; status: 'error' };

/** The repository's open pull requests, or an empty list with a typed error when `gh` fails. */
export type ListRepositoryPullRequestsResult =
	| { pullRequests: RepositoryPullRequestWire[]; status: 'ok' }
	| {
			error: GithubFailure;
			pullRequests: RepositoryPullRequestWire[];
			status: 'error';
	  };

/**
 * The repository's issues, or an empty list with a typed error when `gh` fails
 * and no cached list survives to stand in for it. `source` says whether the rows
 * came off SQLite or straight from `gh`, and `syncedAt` dates them either way.
 *
 * When `gh` fails but a cached list does survive, the result is still `ok` — the
 * rows are real, just old — and `staleError` carries the failure that stopped
 * them being refreshed. A surface that drops it renders stale issues that are
 * indistinguishable from current ones, so both consumers say so instead.
 */
export type ListRepositoryIssuesResult =
	| {
			issues: RepositoryIssueWire[];
			source: 'cache' | 'remote';
			/** Why the refresh failed, when these rows are a cached stand-in. */
			staleError?: GithubFailure;
			status: 'ok';
			syncedAt: string;
	  }
	| { error: GithubFailure; issues: RepositoryIssueWire[]; status: 'error' };

/** IPC surface for the create-from-source picker's repository data. */
export interface RepositorySourcesApi {
	listRepositoryBranches: (
		request: ListRepositoryBranchesRequest,
	) => Promise<ListRepositoryBranchesResult>;
	listRepositoryIssues: (
		request: ListRepositoryIssuesRequest,
	) => Promise<ListRepositoryIssuesResult>;
	listRepositoryPullRequests: (
		request: ListRepositoryPullRequestsRequest,
	) => Promise<ListRepositoryPullRequestsResult>;
}
