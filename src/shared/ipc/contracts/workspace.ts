/**
 * Provider-agnostic reference to a remote issue linked to a workspace. Held in
 * the workspace contract so it does not import provider wire types directly;
 * each provider maps its richer wire shape onto this ref at the IPC seam.
 */
export interface LinkedIssueRef {
	id: string;
	identifier: string;
	title: string;
	url: string;
}

/** Machine-readable codes for problems raised while creating a workspace. */
export type CreateWorkspaceDiagnosticCode =
	| 'branch-already-checked-out'
	| 'branch-name-invalid'
	| 'branch-not-found'
	| 'database-unavailable'
	| 'destination-exists'
	| 'destination-not-writable'
	| 'git-not-installed'
	| 'git-worktree-failed'
	| 'name-invalid'
	| 'repositories-path-missing'
	| 'repository-id-required'
	| 'repository-not-found'
	| 'workspace-insert-failed';

/** Severity level attached to a create-workspace diagnostic. */
export type CreateWorkspaceDiagnosticSeverity = 'error' | 'info' | 'warning';

/** A single problem reported during workspace creation. */
export interface CreateWorkspaceDiagnostic {
	code: CreateWorkspaceDiagnosticCode;
	message: string;
	path?: string;
	severity: CreateWorkspaceDiagnosticSeverity;
}

/** Linked remote issue persisted on a workspace created from an issue. */
export interface WorkspaceLinkedIssueInput extends LinkedIssueRef {
	/**
	 * Linear account the issue belongs to; omitted for GitHub issues. This is
	 * what lets a workspace's later Linear work — status updates, agent ops —
	 * reach the right organization without the user naming it again.
	 */
	accountId?: string;
	/** Issue body/description, seeded into the first-prompt composer draft. */
	description?: string;
	provider: 'github' | 'linear';
	/** Linear team key (e.g. `THE`); omitted for GitHub issues. */
	teamKey?: string;
	/** Linear team name; omitted for GitHub issues. */
	teamName?: string;
}

/**
 * How a new workspace's branch comes into being.
 *
 * `adopt` checks an existing branch out into the worktree, so the workspace
 * owns that branch and pushes land on whatever pull request already tracks it.
 * `create` cuts a fresh branch at `forkRef` (defaulting to the base branch).
 *
 * The fork point is deliberately absent from `adopt` and never persisted in
 * either case: once the worktree exists, the branch's own history records where
 * it came from, while `baseBranch` keeps its separate meaning as the merge
 * target that diffs, conflicts, and pull requests are measured against.
 */
export type WorkspaceBranchPlan =
	| { branch: string; kind: 'adopt' }
	| { forkRef?: string; kind: 'create' };

/** Request payload for creating a workspace. */
export interface CreateWorkspaceRequest {
	baseBranch?: string;
	branchName?: string;
	/** Defaults to `{ kind: 'create' }`, cutting a new branch at the base branch. */
	branchPlan?: WorkspaceBranchPlan;
	linkedIssue?: WorkspaceLinkedIssueInput;
	name?: string;
	/**
	 * True when `name` is an auto-generated composer placeholder (not user-typed).
	 * Recorded in metadata so auto branch-naming only renames placeholders and
	 * never overrides a name the user chose.
	 */
	placeholderName?: boolean;
	repositoryId: string;
}

/** Snapshot of a freshly created workspace returned to the renderer. */
export interface CreatedWorkspaceSnapshot {
	archivedAt: string | null;
	baseBranch: string | null;
	branchName: string | null;
	createdAt: string;
	id: string;
	metadata: Record<string, unknown>;
	name: string;
	path: string;
	repositoryId: string;
	slug: string;
	updatedAt: string;
}

/** Outcome of a create-workspace request. */
export type CreateWorkspaceStatus = 'failure' | 'success';

/** Origin of the files-to-copy pattern list applied to a new worktree. */
export type FilesToCopySource =
	| 'default'
	| 'ensemblr-config'
	| 'personal'
	| 'worktreeinclude';

/** Machine-readable codes for problems copying files into a new worktree. */
export type FilesToCopyDiagnosticCode =
	| 'copy-failed'
	| 'invalid-pattern'
	| 'pattern-listing-failed'
	| 'source-path-missing'
	| 'tracked-skipped';

/** Severity level attached to a files-to-copy diagnostic. */
export type FilesToCopyDiagnosticSeverity = 'error' | 'info' | 'warning';

/** A single problem reported while copying files into a new worktree. */
export interface FilesToCopyDiagnostic {
	code: FilesToCopyDiagnosticCode;
	message: string;
	path?: string;
	pattern?: string;
	severity: FilesToCopyDiagnosticSeverity;
}

/** One file copied into a new worktree, with its source and destination paths. */
export interface FilesToCopyEntry {
	from: string;
	relativePath: string;
	to: string;
}

/** Summary of the files-to-copy step run after a workspace is created. */
export interface FilesToCopySnapshot {
	copied: FilesToCopyEntry[];
	diagnostics: FilesToCopyDiagnostic[];
	patterns: string[];
	skipped: FilesToCopyDiagnostic[];
	source: FilesToCopySource;
}

/** Result of a create-workspace request. */
export interface CreateWorkspaceResult {
	diagnostics: CreateWorkspaceDiagnostic[];
	filesToCopy: FilesToCopySnapshot | null;
	status: CreateWorkspaceStatus;
	workspace: CreatedWorkspaceSnapshot | null;
}

/** Machine-readable codes for problems raised while renaming a workspace. */
export type RenameWorkspaceDiagnosticCode =
	| 'branch-adopted'
	| 'branch-already-exists'
	| 'branch-rename-failed'
	| 'database-unavailable'
	| 'destination-not-writable'
	| 'name-already-in-use'
	| 'name-invalid'
	| 'workspace-not-found'
	| 'worktree-move-failed'
	| 'workspace-update-failed';

/** Severity level attached to a rename-workspace diagnostic. */
export type RenameWorkspaceDiagnosticSeverity = 'error' | 'info' | 'warning';

/** A single problem reported during workspace rename. */
export interface RenameWorkspaceDiagnostic {
	code: RenameWorkspaceDiagnosticCode;
	message: string;
	path?: string;
	severity: RenameWorkspaceDiagnosticSeverity;
}

/** Request payload for renaming a workspace and/or its branch. */
export interface RenameWorkspaceRequest {
	branchName?: string;
	name?: string;
	/**
	 * When true, the rename only proceeds while the git branch still carries the
	 * name it was cut with, and the display name moves only while the workspace
	 * still carries its auto-generated placeholder name. Used by automatic
	 * naming so a user rename that races the LLM suggestion is never
	 * overwritten; both checks run inside the rename's critical section, against
	 * the freshly-read row rather than the caller's pre-flight one.
	 */
	requirePlaceholderName?: boolean;
	workspaceId: string;
}

/** Outcome of a rename-workspace request. */
export type RenameWorkspaceStatus = 'failure' | 'success';

/** Result of a rename-workspace request. */
export interface RenameWorkspaceResult {
	/**
	 * Whether the request actually wrote. A request whose target state already
	 * holds, or whose placeholder gate closed since the caller checked it,
	 * succeeds without changing anything — and returns the same workspace a real
	 * rename would, so the two are indistinguishable by `status` and `workspace`
	 * alone.
	 */
	changed: boolean;
	diagnostics: RenameWorkspaceDiagnostic[];
	status: RenameWorkspaceStatus;
	workspace: CreatedWorkspaceSnapshot | null;
}

/** Machine-readable codes for problems raised while retargeting a workspace. */
export type SetWorkspaceBaseBranchDiagnosticCode =
	| 'base-branch-invalid'
	| 'base-branch-unresolvable'
	| 'database-unavailable'
	| 'workspace-not-found';

/** Severity level attached to a set-workspace-base-branch diagnostic. */
export type SetWorkspaceBaseBranchDiagnosticSeverity = 'error' | 'warning';

/** A single problem reported while retargeting a workspace's base branch. */
export interface SetWorkspaceBaseBranchDiagnostic {
	code: SetWorkspaceBaseBranchDiagnosticCode;
	message: string;
	severity: SetWorkspaceBaseBranchDiagnosticSeverity;
}

/**
 * Retargets which branch a workspace reviews and opens pull requests against.
 * The worktree keeps the fork point it was created from; only the merge-base
 * used for diffs, conflicts, and the PR target changes.
 */
export interface SetWorkspaceBaseBranchRequest {
	baseBranch: string;
	workspaceId: string;
}

/** Outcome of a set-workspace-base-branch request. */
export type SetWorkspaceBaseBranchStatus = 'failure' | 'success';

/** Result of a set-workspace-base-branch request. */
export interface SetWorkspaceBaseBranchResult {
	baseBranch: string | null;
	diagnostics: SetWorkspaceBaseBranchDiagnostic[];
	status: SetWorkspaceBaseBranchStatus;
}

/**
 * Continues a workspace past its merged pull request by branching onto a
 * `-v<n>` successor and checking it out. The successor forks from the base
 * branch when the workspace's committed tree already matches it, so the review
 * panel opens empty rather than re-listing squash-merged work; when the branch
 * still holds commits the base has not taken, the fork falls back to the current
 * HEAD and the result carries a `base-branch-unsynced` warning. The merged
 * branch stays where it is, so the old PR keeps its history while the workspace
 * stops resolving to it — `gh pr view` matches by head-ref name, and the fresh
 * branch has none until a new PR is opened. Uncommitted work carries over
 * untouched.
 */
export type ContinueWorkspaceBranchDiagnosticCode =
	| 'base-branch-unsynced'
	| 'branch-checkout-failed'
	| 'branch-rollback-failed'
	| 'branch-unresolved'
	| 'database-unavailable'
	| 'workspace-not-found'
	| 'workspace-update-failed';

/** Severity level attached to a continue-workspace-branch diagnostic. */
export type ContinueWorkspaceBranchDiagnosticSeverity =
	| 'error'
	| 'info'
	| 'warning';

/** A single problem reported while continuing a workspace onto a new branch. */
export interface ContinueWorkspaceBranchDiagnostic {
	code: ContinueWorkspaceBranchDiagnosticCode;
	message: string;
	severity: ContinueWorkspaceBranchDiagnosticSeverity;
}

/** Request payload for continuing a workspace onto a successor branch. */
export interface ContinueWorkspaceBranchRequest {
	workspaceId: string;
}

/** Outcome of a continue-workspace-branch request. */
export type ContinueWorkspaceBranchStatus = 'failure' | 'success';

/** Result of a continue-workspace-branch request. */
export interface ContinueWorkspaceBranchResult {
	/** The branch now checked out, or null when the request failed. */
	branchName: string | null;
	/** Empty on a clean success; a successful continue can still carry warnings. */
	diagnostics: ContinueWorkspaceBranchDiagnostic[];
	/** The branch the workspace was on before, retained for the success toast. */
	previousBranchName: string | null;
	status: ContinueWorkspaceBranchStatus;
	workspaceId: string;
}

/**
 * Lifecycle archive of a workspace. Preserves the `.context/` directory under
 * `<root>/archived-contexts/`, records an archive snapshot for later script
 * hooks (ENS-038) and after-merge cleanup (ENS-060), and stamps
 * `workspaces.archived_at`.
 *
 * What happens to the worktree is the caller's choice. By default it stays on
 * disk. `reclaimDisk` removes the directory but keeps the branch, snapshotting
 * uncommitted work into a private ref so unarchive can re-derive the whole
 * workspace from git; `branchCleanup` goes further and drops the branch too,
 * which is not reversible. Both are opt-in and surface explicit diagnostics.
 */
export type ArchiveWorkspaceDiagnosticCode =
	| 'archive-aborted-by-hook'
	| 'archived-context-already-exists'
	| 'archived-context-copy-failed'
	| 'archived-contexts-directory-missing'
	| 'branch-cleanup-failed'
	| 'database-unavailable'
	| 'lifecycle-hook-failed'
	| 'workspace-already-archived'
	| 'workspace-id-required'
	| 'workspace-not-found'
	| 'workspace-update-failed'
	| 'worktree-prune-failed';

/** Severity level attached to an archive-workspace diagnostic. */
export type ArchiveWorkspaceDiagnosticSeverity = 'error' | 'info' | 'warning';

/** A single problem reported during workspace archiving. */
export interface ArchiveWorkspaceDiagnostic {
	code: ArchiveWorkspaceDiagnosticCode;
	message: string;
	path?: string;
	severity: ArchiveWorkspaceDiagnosticSeverity;
}

/** Request payload for archiving a workspace, optionally reclaiming its disk. */
export interface ArchiveWorkspaceRequest {
	/** Also delete the local branch. Removes the worktree, and is not reversible. */
	branchCleanup?: boolean;
	reason?: string;
	/**
	 * Remove the worktree directory but keep the branch, so unarchive re-derives
	 * the workspace from git. Implied by `branchCleanup`, which removes the
	 * directory anyway.
	 */
	reclaimDisk?: boolean;
	workspaceId: string;
}

/** Outcome of an archive-workspace request. */
export type ArchiveWorkspaceStatus = 'aborted' | 'failure' | 'success';

/** Snapshot of a workspace after it has been archived. */
export interface ArchivedWorkspaceSnapshot {
	archivedAt: string;
	archivedContextPath: string | null;
	branchCleanup: boolean;
	branchDeleted: boolean;
	branchName: string | null;
	/** Bytes the worktree removal reclaimed, or null when it did not run or could not be measured. */
	bytesFreed: number | null;
	id: string;
	name: string;
	path: string;
	repositoryId: string;
	slug: string;
	/** True when the worktree directory was removed and the workspace is re-derived on unarchive. */
	worktreePruned: boolean;
}

/** Result of an archive-workspace request. */
export interface ArchiveWorkspaceResult {
	archiveRecordId: string | null;
	diagnostics: ArchiveWorkspaceDiagnostic[];
	status: ArchiveWorkspaceStatus;
	workspace: ArchivedWorkspaceSnapshot | null;
}

/**
 * Hard delete (destructive) of a workspace. Removes the worktree folder, drops
 * the local branch (best-effort), and deletes the SQLite row. No `.context/`
 * preservation, no lifecycle hooks beyond a pre-delete safety record. Intended
 * only for workspaces the user has explicitly chosen to discard.
 */
export type DeleteWorkspaceDiagnosticCode =
	| 'database-unavailable'
	| 'workspace-delete-failed'
	| 'workspace-id-required'
	| 'workspace-not-found';

/** Severity level attached to a delete-workspace diagnostic. */
export type DeleteWorkspaceDiagnosticSeverity = 'error' | 'info' | 'warning';

/** A single problem reported during workspace hard-delete. */
export interface DeleteWorkspaceDiagnostic {
	code: DeleteWorkspaceDiagnosticCode;
	message: string;
	path?: string;
	severity: DeleteWorkspaceDiagnosticSeverity;
}

/** Request payload for hard-deleting a workspace. */
export interface DeleteWorkspaceRequest {
	workspaceId: string;
}

/** Outcome of a hard-delete request. */
export type DeleteWorkspaceStatus = 'failure' | 'success';

/** Snapshot of a workspace as it existed just before hard-delete. */
export interface DeletedWorkspaceSnapshot {
	branchName: string | null;
	id: string;
	name: string;
	path: string;
	repositoryId: string;
}

/** Result of a hard-delete request. */
export interface DeleteWorkspaceResult {
	branchDeleted: boolean;
	diagnostics: DeleteWorkspaceDiagnostic[];
	pathRemoved: boolean;
	status: DeleteWorkspaceStatus;
	workspace: DeletedWorkspaceSnapshot | null;
}

/** Snapshot of a workspace adopted from a pre-existing worktree. */
export interface AdoptedWorkspaceSnapshot {
	adoptedAt: string;
	archivedAt: string | null;
	baseBranch: string | null;
	branchName: string | null;
	createdAt: string;
	id: string;
	metadata: Record<string, unknown>;
	name: string;
	path: string;
	repositoryId: string;
	slug: string;
	updatedAt: string;
}

/**
 * Reverses a workspace lifecycle archive. NULLs `archived_at`, restores the
 * preserved `.context/` directory back into the worktree, and re-runs
 * lifecycle hooks.
 *
 * How the worktree comes back depends on how it went away. A pruned archive is
 * re-derived from git: the branch is checked out again and the snapshotted
 * working tree restored on top, so committed and uncommitted work both return.
 * An archive that ran with `branchCleanup: true` has no branch left, so the
 * worktree is recreated from the recorded base branch and its commits are gone.
 */
export type UnarchiveWorkspaceDiagnosticCode =
	| 'archived-context-missing'
	| 'archived-context-restore-failed'
	| 'archive-record-missing'
	| 'base-branch-missing'
	| 'database-unavailable'
	| 'lifecycle-hook-failed'
	| 'pruned-branch-missing'
	| 'pruned-snapshot-missing'
	| 'pruned-snapshot-restore-failed'
	| 'unarchive-aborted-by-hook'
	| 'workspace-id-required'
	| 'workspace-not-archived'
	| 'workspace-not-found'
	| 'workspace-update-failed'
	| 'worktree-recreate-failed';

/** Severity level attached to an unarchive-workspace diagnostic. */
export type UnarchiveWorkspaceDiagnosticSeverity = 'error' | 'info' | 'warning';

/** A single problem reported during workspace unarchiving. */
export interface UnarchiveWorkspaceDiagnostic {
	code: UnarchiveWorkspaceDiagnosticCode;
	message: string;
	path?: string;
	severity: UnarchiveWorkspaceDiagnosticSeverity;
}

/** Request payload for unarchiving a workspace. */
export interface UnarchiveWorkspaceRequest {
	reason?: string;
	workspaceId: string;
}

/** Outcome of an unarchive-workspace request. */
export type UnarchiveWorkspaceStatus = 'aborted' | 'failure' | 'success';

/** Snapshot of a workspace after it has been unarchived. */
export interface UnarchivedWorkspaceSnapshot {
	branchName: string | null;
	branchRecreated: boolean;
	contextRestored: boolean;
	id: string;
	/** True when the workspace was re-derived from git rather than found on disk. */
	rehydrated: boolean;
	name: string;
	path: string;
	repositoryId: string;
	slug: string;
	unarchivedAt: string;
}

/** Result of an unarchive-workspace request. */
export interface UnarchiveWorkspaceResult {
	diagnostics: UnarchiveWorkspaceDiagnostic[];
	status: UnarchiveWorkspaceStatus;
	workspace: UnarchivedWorkspaceSnapshot | null;
}

/**
 * Permanently purges an archived workspace: drops the workspace + archive
 * rows, removes the preserved archived-contexts directory, and cleans up the
 * worktree / branch if they are still on disk.
 */
export type DeleteArchivedWorkspaceDiagnosticCode =
	| 'archive-record-missing'
	| 'archived-context-cleanup-failed'
	| 'branch-cleanup-failed'
	| 'database-unavailable'
	| 'workspace-delete-failed'
	| 'workspace-id-required'
	| 'workspace-not-archived'
	| 'workspace-not-found'
	| 'worktree-cleanup-failed';

/** Severity level attached to a delete-archived-workspace diagnostic. */
export type DeleteArchivedWorkspaceDiagnosticSeverity =
	| 'error'
	| 'info'
	| 'warning';

/** A single problem reported while permanently deleting an archived workspace. */
export interface DeleteArchivedWorkspaceDiagnostic {
	code: DeleteArchivedWorkspaceDiagnosticCode;
	message: string;
	path?: string;
	severity: DeleteArchivedWorkspaceDiagnosticSeverity;
}

/** Request payload for permanently deleting an archived workspace. */
export interface DeleteArchivedWorkspaceRequest {
	workspaceId: string;
}

/** Outcome of a delete-archived-workspace request. */
export type DeleteArchivedWorkspaceStatus = 'failure' | 'success';

/** Result of a delete-archived-workspace request. */
export interface DeleteArchivedWorkspaceResult {
	branchDeleted: boolean;
	contextRemoved: boolean;
	diagnostics: DeleteArchivedWorkspaceDiagnostic[];
	pathRemoved: boolean;
	status: DeleteArchivedWorkspaceStatus;
	workspaceId: string;
}

/** Single row in the browse-archive list. */
export interface ArchivedWorkspaceListEntry {
	archivedAt: string;
	archivedContextPath: string | null;
	archiveRecordId: string | null;
	baseBranch: string | null;
	branchCleanup: boolean;
	branchName: string | null;
	id: string;
	name: string;
	path: string;
	/**
	 * True when the worktree directory is still on disk, so the row can offer to
	 * reclaim it. Probed per listing rather than inferred from `worktreePruned`,
	 * which says only what Ensemblr did, not what is there now.
	 */
	pathExists: boolean;
	repositoryId: string;
	slug: string;
	/** True when Ensemblr removed the worktree and keeps the branch for re-derivation. */
	worktreePruned: boolean;
}

/**
 * Reclaims the disk an already-archived workspace still occupies: removes its
 * worktree directory while keeping the branch, after snapshotting the working
 * tree into a private ref. The retroactive counterpart of archiving with
 * `reclaimDisk: true`, for archives made before the setting existed.
 */
export type ReclaimArchivedWorkspaceDiskDiagnosticCode =
	| 'database-unavailable'
	| 'archive-record-missing'
	| 'workspace-ids-required'
	| 'workspace-not-archived'
	| 'workspace-not-found'
	| 'workspace-update-failed'
	| 'worktree-already-pruned'
	| 'worktree-prune-failed';

/** Severity level attached to a reclaim-disk diagnostic. */
export type ReclaimArchivedWorkspaceDiskDiagnosticSeverity =
	| 'error'
	| 'info'
	| 'warning';

/** A single problem reported while reclaiming an archived workspace's disk. */
export interface ReclaimArchivedWorkspaceDiskDiagnostic {
	code: ReclaimArchivedWorkspaceDiskDiagnosticCode;
	message: string;
	path?: string;
	severity: ReclaimArchivedWorkspaceDiskDiagnosticSeverity;
}

/**
 * Request payload for reclaiming archived workspaces' disk. Takes a list so one
 * call serves both a single row's button and the archive browser's bulk action.
 */
export interface ReclaimArchivedWorkspaceDiskRequest {
	workspaceIds: string[];
}

/** Outcome for one workspace in a reclaim-disk request. */
export type ReclaimArchivedWorkspaceDiskStatus =
	| 'failure'
	| 'reclaimed'
	| 'skipped';

/** What reclaiming one archived workspace's disk produced. */
export interface ReclaimArchivedWorkspaceDiskEntry {
	/** Bytes reclaimed, or null when the removal did not run or could not be measured. */
	bytesFreed: number | null;
	diagnostics: ReclaimArchivedWorkspaceDiskDiagnostic[];
	status: ReclaimArchivedWorkspaceDiskStatus;
	workspaceId: string;
}

/** Result of a reclaim-disk request, one entry per requested workspace. */
export interface ReclaimArchivedWorkspaceDiskResult {
	/** Sum of every entry's `bytesFreed`, ignoring the ones that could not be measured. */
	bytesFreed: number;
	/**
	 * Problems with the request itself rather than with any one workspace — an
	 * unopenable database, an id list that arrived empty. They live here because
	 * such a request has no entries to hang them off, and a result that is empty
	 * in every field is indistinguishable from "there was nothing to reclaim".
	 */
	diagnostics: ReclaimArchivedWorkspaceDiskDiagnostic[];
	entries: ReclaimArchivedWorkspaceDiskEntry[];
	reclaimedCount: number;
}

/** Request payload for listing a repository's archived workspaces. */
export interface ListArchivedWorkspacesRequest {
	repositoryId: string;
}

/** Archived workspaces belonging to a repository, returned to the browse-archive UI. */
export interface ListArchivedWorkspacesResult {
	entries: ArchivedWorkspaceListEntry[];
	repositoryId: string;
}

/**
 * Single row in the global History screen: every workspace ever created,
 * across all repositories, active or archived. Distinct from
 * {@link ArchivedWorkspaceListEntry} because `archivedAt` is nullable here
 * (null === active / still in the sidebar) and the repository display name +
 * lifecycle timestamps are included so the renderer can group by last activity
 * and gate the Unarchive action without a second round-trip.
 */
export interface WorkspaceHistoryEntry {
	/** ISO timestamp when archived, or null when the workspace is still active. */
	archivedAt: string | null;
	/** Recorded base branch from the latest archive record; needed to gate unarchive when the worktree was destroyed. */
	baseBranch: string | null;
	/** True when the original archive removed the worktree + branch. */
	branchCleanup: boolean;
	branchName: string | null;
	createdAt: string;
	id: string;
	name: string;
	path: string;
	repositoryId: string;
	repositoryName: string;
	slug: string;
	updatedAt: string;
	/** True when the archive removed the worktree but kept the branch to re-derive it from. */
	worktreePruned: boolean;
}

/** Every workspace across all repositories, backing the global History screen. */
export interface ListAllWorkspacesResult {
	entries: WorkspaceHistoryEntry[];
}

/** Persisted archive_records row exposed to the renderer for diagnostics + history. */
export interface ArchiveRecordSnapshot {
	archiveReason: string | null;
	archivedAt: string;
	archivedContextPath: string | null;
	baseBranch: string | null;
	branchCleanup: boolean;
	branchName: string | null;
	id: string;
	metadata: Record<string, unknown>;
	recordType: 'repository' | 'workspace';
	repositoryId: string;
	repositorySlug: string;
	sourcePath: string;
	workspaceId: string | null;
	workspaceSlug: string | null;
}

/** Workspace lifecycle IPC surface (create / rename / continue / hard-delete). */
export interface WorkspaceApi {
	continueWorkspaceBranch: (
		request: ContinueWorkspaceBranchRequest,
	) => Promise<ContinueWorkspaceBranchResult>;
	createWorkspace: (
		request: CreateWorkspaceRequest,
	) => Promise<CreateWorkspaceResult>;
	deleteWorkspace: (
		request: DeleteWorkspaceRequest,
	) => Promise<DeleteWorkspaceResult>;
	renameWorkspace: (
		request: RenameWorkspaceRequest,
	) => Promise<RenameWorkspaceResult>;
	setWorkspaceBaseBranch: (
		request: SetWorkspaceBaseBranchRequest,
	) => Promise<SetWorkspaceBaseBranchResult>;
}
