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

/**
 * What a status/diff request compares against:
 *
 *   - `working-tree`: the working tree (staged + unstaged + untracked) vs HEAD —
 *     the uncommitted change set. This is the default when no scope is sent.
 *   - `commit`: the changes a single commit introduced (`<hash>^..<hash>`, or the
 *     empty tree for a root commit).
 *   - `branch`: every change on this branch — the diff from the fork point
 *     (`merge-base(baseRef, HEAD)`) to the working tree, so committed-on-branch
 *     changes and uncommitted edits both appear. Falls back to `working-tree`
 *     when no merge-base can be resolved.
 */
export type WorkspaceGitDiffScope =
	| { kind: 'working-tree' }
	| { commitHash: string; kind: 'commit' }
	| { baseRef: string; kind: 'branch' };

/**
 * Stable short key for a diff scope. Backs query-cache keys and diff-tab
 * identity so two scopes of the same file never collide. Keep the output
 * deterministic — it is compared verbatim across the IPC boundary.
 */
export function serializeWorkspaceGitDiffScope(
	scope: WorkspaceGitDiffScope | undefined,
): string {
	if (!scope || scope.kind === 'working-tree') {
		return 'working-tree';
	}
	if (scope.kind === 'commit') {
		return `commit:${scope.commitHash}`;
	}
	return `branch:${scope.baseRef}`;
}

/**
 * Reads a diff scope from untyped persisted/wire data (e.g. tab metadata),
 * returning `undefined` when the shape is not a recognized scope. The narrowed
 * result drops any extra keys, so a round-tripped scope stays canonical.
 */
export function parseWorkspaceGitDiffScope(
	value: unknown,
): WorkspaceGitDiffScope | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const scope = value as {
		baseRef?: unknown;
		commitHash?: unknown;
		kind?: unknown;
	};
	if (scope.kind === 'commit' && typeof scope.commitHash === 'string') {
		return { commitHash: scope.commitHash, kind: 'commit' };
	}
	if (scope.kind === 'branch' && typeof scope.baseRef === 'string') {
		return { baseRef: scope.baseRef, kind: 'branch' };
	}
	if (scope.kind === 'working-tree') {
		return { kind: 'working-tree' };
	}
	return undefined;
}

export interface GetWorkspaceGitStatusRequest {
	/** Defaults to the working tree (uncommitted changes) when omitted. */
	scope?: WorkspaceGitDiffScope;
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
	/** Defaults to the working tree (file vs HEAD) when omitted. */
	scope?: WorkspaceGitDiffScope;
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
	/**
	 * Base branch to scope the log to this workspace's own commits
	 * (`merge-base(baseRef, HEAD)..HEAD`). Omitted or unresolvable falls back to
	 * the full HEAD history.
	 */
	baseRef?: string;
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
