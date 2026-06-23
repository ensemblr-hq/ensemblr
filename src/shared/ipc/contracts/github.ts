/**
 * Wire contracts for the `gh`-backed GitHub integration (THE-154, THE-155,
 * THE-158). All GitHub access goes through the authenticated `gh` CLI per ADR
 * 0013 — no app-owned OAuth or API client.
 */

/** Stable failure classification for git/gh review-flow operations. */
export type GithubFailureCode =
	| 'command-failed'
	| 'dirty-state'
	| 'gh-not-authenticated'
	| 'gh-not-installed'
	| 'invalid-cwd'
	| 'merge-blocked'
	| 'no-pull-request'
	| 'no-remote'
	| 'nothing-to-commit'
	| 'parse-failed'
	| 'permission-denied';

export interface GithubFailure {
	code: GithubFailureCode;
	message: string;
	/** Actionable next step shown beside the error (e.g. run `gh auth login`). */
	remediation?: string;
}

/** Simplified check bucket derived from check-run status + conclusion. */
export type GithubCheckBucket = 'failing' | 'passing' | 'pending' | 'skipped';

export interface GithubCheckWire {
	bucket: GithubCheckBucket;
	completedAt?: string;
	detailsUrl?: string;
	id: string;
	name: string;
	startedAt?: string;
	/** Workflow name or context source when available. */
	workflowName?: string;
}

/** Source priority for preview/deployment URLs (ADR-driven order). */
export type GithubDeploymentSource =
	| 'check-link'
	| 'github-deployment'
	| 'pr-comment';

export interface GithubDeploymentWire {
	environment: string;
	id: string;
	source: GithubDeploymentSource;
	state: 'active' | 'failure' | 'inactive' | 'pending' | 'success';
	url?: string;
}

export type GithubCommentKind = 'issue-comment' | 'review' | 'review-comment';

export interface GithubCommentWire {
	author: string;
	body: string;
	createdAt: string;
	id: string;
	/** Resolution state for review threads; `null` when not applicable/unknown. */
	isResolved: boolean | null;
	kind: GithubCommentKind;
	line?: number;
	path?: string;
	url?: string;
}

export type GithubPullRequestState = 'closed' | 'merged' | 'open';

export type GithubMergeableState = 'conflicting' | 'mergeable' | 'unknown';

export interface GithubPullRequestWire {
	additions: number | null;
	baseRefName: string;
	body: string;
	checks: readonly GithubCheckWire[];
	comments: readonly GithubCommentWire[];
	deletions: number | null;
	deployments: readonly GithubDeploymentWire[];
	headRefName: string;
	/** Head-branch tip commit at the PR, used to confirm branch identity. */
	headRefOid: string;
	isDraft: boolean;
	mergeable: GithubMergeableState;
	/** GraphQL mergeStateStatus (BLOCKED, CLEAN, DIRTY, …) when exposed. */
	mergeStateStatus?: string;
	number: number;
	reviewDecision?: string;
	state: GithubPullRequestState;
	title: string;
	updatedAt: string;
	url: string;
}

/** Local branch sync state relative to its upstream. */
export interface GitBranchSyncWire {
	ahead: number;
	behind: number;
	branchName: string;
	hasUpstream: boolean;
}

/** Cached or freshly-fetched PR snapshot for one workspace. */
export interface GithubPullRequestSnapshotWire {
	branchSync: GitBranchSyncWire | null;
	pullRequest: GithubPullRequestWire | null;
	syncedAt: string;
}

// --- Commit / push / PR create (THE-154) -------------------------------------

export interface CommitWorkspaceChangesRequest {
	message: string;
	/** Restrict staging to these workspace-relative paths; defaults to all. */
	paths?: readonly string[];
	workspaceCwd: string;
}

export interface CommitWorkspaceChangesResult {
	commitHash?: string;
	error?: GithubFailure;
	ok: boolean;
}

export interface PushWorkspaceBranchRequest {
	/**
	 * Whether to pass `--set-upstream` so the pushed branch tracks `origin`.
	 * Defaults to `true` when omitted; gated by the `setUpstreamOnPush` setting.
	 */
	setUpstream?: boolean;
	workspaceCwd: string;
}

export interface PushWorkspaceBranchResult {
	error?: GithubFailure;
	ok: boolean;
}

export interface CreatePullRequestRequest {
	baseBranch?: string;
	body: string;
	draft?: boolean;
	title: string;
	workspaceCwd: string;
}

export interface CreatePullRequestResult {
	error?: GithubFailure;
	ok: boolean;
	pullRequestNumber?: number;
	pullRequestUrl?: string;
}

// --- PR metadata snapshot (THE-155) ------------------------------------------

export interface GetPullRequestSnapshotRequest {
	/** Force a `gh` refresh even when a fresh cache row exists. */
	refresh?: boolean;
	workspaceCwd: string;
	workspaceId: string;
}

export interface GetPullRequestSnapshotResult {
	error?: GithubFailure;
	/** True when the snapshot came from the SQLite cache without a refresh. */
	fromCache: boolean;
	snapshot: GithubPullRequestSnapshotWire | null;
}

// --- Merge (THE-158) ----------------------------------------------------------

export type GithubMergeMethod = 'merge' | 'rebase' | 'squash';

export interface MergePullRequestRequest {
	method?: GithubMergeMethod;
	workspaceCwd: string;
	workspaceId: string;
}

export interface MergePullRequestResult {
	error?: GithubFailure;
	merged: boolean;
}

/** GitHub review-flow IPC surface (commit/push/PR/checks/merge through `gh`). */
export interface GithubApi {
	commitWorkspaceChanges: (
		request: CommitWorkspaceChangesRequest,
	) => Promise<CommitWorkspaceChangesResult>;
	createPullRequest: (
		request: CreatePullRequestRequest,
	) => Promise<CreatePullRequestResult>;
	getPullRequestSnapshot: (
		request: GetPullRequestSnapshotRequest,
	) => Promise<GetPullRequestSnapshotResult>;
	mergePullRequest: (
		request: MergePullRequestRequest,
	) => Promise<MergePullRequestResult>;
	pushWorkspaceBranch: (
		request: PushWorkspaceBranchRequest,
	) => Promise<PushWorkspaceBranchResult>;
}
