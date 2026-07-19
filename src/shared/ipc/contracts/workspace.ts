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
	/** Issue body/description, seeded into the first-prompt composer draft. */
	description?: string;
	provider: 'github' | 'linear';
	/** Linear team key (e.g. `THE`); omitted for GitHub issues. */
	teamKey?: string;
	/** Linear team name; omitted for GitHub issues. */
	teamName?: string;
}

/** Request payload for creating a workspace. */
export interface CreateWorkspaceRequest {
	baseBranch?: string;
	branchName?: string;
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
	workspaceId: string;
}

/** Outcome of a rename-workspace request. */
export type RenameWorkspaceStatus = 'failure' | 'success';

/** Result of a rename-workspace request. */
export interface RenameWorkspaceResult {
	diagnostics: RenameWorkspaceDiagnostic[];
	status: RenameWorkspaceStatus;
	workspace: CreatedWorkspaceSnapshot | null;
}

/**
 * Lifecycle archive of a workspace. Preserves the `.context/` directory under
 * `<root>/archived-contexts/`, records an archive snapshot for later script
 * hooks (ENS-038) and after-merge cleanup (ENS-060), and stamps
 * `workspaces.archived_at`. The worktree folder stays on disk so a future
 * subscriber (or the user) can still inspect uncommitted handoff files. Branch
 * cleanup is opt-in and surfaces an explicit confirmation diagnostic on the
 * result.
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
	| 'workspace-update-failed';

/** Severity level attached to an archive-workspace diagnostic. */
export type ArchiveWorkspaceDiagnosticSeverity = 'error' | 'info' | 'warning';

/** A single problem reported during workspace archiving. */
export interface ArchiveWorkspaceDiagnostic {
	code: ArchiveWorkspaceDiagnosticCode;
	message: string;
	path?: string;
	severity: ArchiveWorkspaceDiagnosticSeverity;
}

/** Request payload for archiving a workspace, optionally cleaning up its branch. */
export interface ArchiveWorkspaceRequest {
	branchCleanup?: boolean;
	reason?: string;
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
	id: string;
	name: string;
	path: string;
	repositoryId: string;
	slug: string;
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
 * lifecycle hooks. When the original archive ran with `branchCleanup: true`
 * the worktree + branch are recreated from the recorded base branch.
 */
export type UnarchiveWorkspaceDiagnosticCode =
	| 'archived-context-missing'
	| 'archived-context-restore-failed'
	| 'archive-record-missing'
	| 'base-branch-missing'
	| 'database-unavailable'
	| 'lifecycle-hook-failed'
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
	repositoryId: string;
	slug: string;
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

/** Workspace lifecycle IPC surface (create / rename / hard-delete). */
export interface WorkspaceApi {
	createWorkspace: (
		request: CreateWorkspaceRequest,
	) => Promise<CreateWorkspaceResult>;
	deleteWorkspace: (
		request: DeleteWorkspaceRequest,
	) => Promise<DeleteWorkspaceResult>;
	renameWorkspace: (
		request: RenameWorkspaceRequest,
	) => Promise<RenameWorkspaceResult>;
}
