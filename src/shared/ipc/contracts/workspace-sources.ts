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
	/** Bare branch name, e.g. `master` or `psoldunov/feature-x`. */
	name: string;
	/** Id of the active workspace tracking this branch when {@link hasWorkspace}. */
	workspaceId: string | null;
}

/**
 * An open pull request offered as a workspace source. Limited to same-repo PRs:
 * a workspace forks off `origin/<headRefName>`, which only resolves when the head
 * lives on the origin remote, so {@link isCrossRepository} PRs are filtered out
 * before they reach the picker.
 */
export interface RepositoryPullRequestWire {
	authorLogin: string | null;
	/** Head branch name; the new workspace forks off `origin/<headRefName>`. */
	headRefName: string;
	/** True when the head lives on a fork; such PRs cannot be forked locally. */
	isCrossRepository: boolean;
	isDraft: boolean;
	number: number;
	state: string;
	title: string;
	updatedAt: string;
	url: string;
}

/** A GitHub issue offered as a workspace source. */
export interface RepositoryIssueWire {
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

/** Request to list a repository's issues. */
export interface ListRepositoryIssuesRequest {
	repositoryId: string;
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

/** The repository's issues, or an empty list with a typed error when `gh` fails. */
export type ListRepositoryIssuesResult =
	| { issues: RepositoryIssueWire[]; status: 'ok' }
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
