/**
 * Wire contracts for workspace git status and unified file diffs (THE-150,
 * THE-151). Git/worktree state is the source of truth; the renderer only
 * receives derived rows and patches.
 */

/** Per-file change classification derived from `git status --porcelain -z`. */
export type WorkspaceGitFileStatus =
	| 'added'
	| 'conflicted'
	| 'deleted'
	| 'ignored'
	| 'modified'
	| 'renamed'
	| 'untracked';

/** One changed file in the workspace working tree relative to HEAD. */
export interface WorkspaceGitFileWire {
	/** Lines added, or `null` for binary files. */
	additions: number | null;
	/** Lines deleted, or `null` for binary files. */
	deletions: number | null;
	path: string;
	/** Previous path when `status` is `renamed`. */
	renamedFrom?: string;
	status: WorkspaceGitFileStatus;
}

/** Aggregate counts across all changed files. */
export interface WorkspaceGitChangeSummaryWire {
	additions: number;
	deletions: number;
	files: number;
}

export interface GetWorkspaceGitStatusRequest {
	workspaceCwd: string;
}

export type WorkspaceGitFailureCode =
	| 'command-failed'
	| 'invalid-cwd'
	| 'not-a-git-repo';

export interface GetWorkspaceGitStatusResult {
	error?: {
		code: WorkspaceGitFailureCode;
		message: string;
	};
	files: readonly WorkspaceGitFileWire[];
	summary: WorkspaceGitChangeSummaryWire;
}

export interface GetWorkspaceFileDiffRequest {
	path: string;
	workspaceCwd: string;
}

export type WorkspaceFileDiffFailureCode =
	| WorkspaceGitFailureCode
	| 'invalid-path';

export interface GetWorkspaceFileDiffResult {
	error?: {
		code: WorkspaceFileDiffFailureCode;
		message: string;
	};
	/** True when the diff body was cut at the output cap. */
	isTruncated?: boolean;
	patch?: string;
	path: string;
}

/** One commit reachable from the workspace HEAD, newest first. */
export interface WorkspaceCommitWire {
	/** Author display name (`%an`). */
	author: string;
	/** Full 40-char commit hash (`%H`). */
	hash: string;
	/** Author date in strict ISO-8601 (`%aI`). */
	isoDate: string;
	/** Human relative author date from git (`%ar`), e.g. "18 hours ago". */
	relativeTime: string;
	/** Abbreviated commit hash (`%h`). */
	shortHash: string;
	/** Commit subject line (`%s`). */
	subject: string;
}

export interface GetWorkspaceCommitsRequest {
	/** Max commits to return; clamped server-side. Defaults to a small page. */
	limit?: number;
	workspaceCwd: string;
}

export interface GetWorkspaceCommitsResult {
	commits: readonly WorkspaceCommitWire[];
	error?: {
		code: WorkspaceGitFailureCode;
		message: string;
	};
}

export type WorkspaceDiscardFailureCode =
	| WorkspaceGitFailureCode
	| 'invalid-path';

export interface DiscardWorkspaceChangesRequest {
	/**
	 * Workspace-relative paths to discard. For a rename, include both the new
	 * path and its `renamedFrom` so the original is restored too.
	 */
	paths: readonly string[];
	workspaceCwd: string;
}

export interface DiscardWorkspaceChangesResult {
	/** Paths that were successfully reverted/removed. */
	discarded: readonly string[];
	error?: {
		code: WorkspaceDiscardFailureCode;
		message: string;
	};
}

/** Workspace git IPC surface — change status rows and unified per-file diffs. */
export interface WorkspaceGitApi {
	discardWorkspaceChanges: (
		request: DiscardWorkspaceChangesRequest,
	) => Promise<DiscardWorkspaceChangesResult>;
	getWorkspaceCommits: (
		request: GetWorkspaceCommitsRequest,
	) => Promise<GetWorkspaceCommitsResult>;
	getWorkspaceFileDiff: (
		request: GetWorkspaceFileDiffRequest,
	) => Promise<GetWorkspaceFileDiffResult>;
	getWorkspaceGitStatus: (
		request: GetWorkspaceGitStatusRequest,
	) => Promise<GetWorkspaceGitStatusResult>;
}
