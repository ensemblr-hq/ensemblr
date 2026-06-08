export type CreateWorkspaceDiagnosticCode =
	| 'context-directory-failed'
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

export type CreateWorkspaceDiagnosticSeverity = 'error' | 'info' | 'warning';

export interface CreateWorkspaceDiagnostic {
	code: CreateWorkspaceDiagnosticCode;
	message: string;
	path?: string;
	severity: CreateWorkspaceDiagnosticSeverity;
}

export interface CreateWorkspaceRequest {
	baseBranch?: string;
	branchName?: string;
	name?: string;
	repositoryId: string;
}

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

export type CreateWorkspaceStatus = 'failure' | 'success';

export type FilesToCopySource =
	| 'conductor-config'
	| 'conductor-legacy-config'
	| 'conductor-local-config'
	| 'default'
	| 'ensemble-config'
	| 'worktreeinclude';

export type FilesToCopyDiagnosticCode =
	| 'copy-failed'
	| 'invalid-pattern'
	| 'pattern-listing-failed'
	| 'source-path-missing'
	| 'tracked-skipped';

export type FilesToCopyDiagnosticSeverity = 'error' | 'info' | 'warning';

export interface FilesToCopyDiagnostic {
	code: FilesToCopyDiagnosticCode;
	message: string;
	path?: string;
	pattern?: string;
	severity: FilesToCopyDiagnosticSeverity;
}

export interface FilesToCopyEntry {
	from: string;
	relativePath: string;
	to: string;
}

export interface FilesToCopySnapshot {
	copied: FilesToCopyEntry[];
	diagnostics: FilesToCopyDiagnostic[];
	patterns: string[];
	skipped: FilesToCopyDiagnostic[];
	source: FilesToCopySource;
}

export interface CreateWorkspaceResult {
	diagnostics: CreateWorkspaceDiagnostic[];
	filesToCopy: FilesToCopySnapshot | null;
	status: CreateWorkspaceStatus;
	workspace: CreatedWorkspaceSnapshot | null;
}

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

export type RenameWorkspaceDiagnosticSeverity = 'error' | 'info' | 'warning';

export interface RenameWorkspaceDiagnostic {
	code: RenameWorkspaceDiagnosticCode;
	message: string;
	path?: string;
	severity: RenameWorkspaceDiagnosticSeverity;
}

export interface RenameWorkspaceRequest {
	branchName?: string;
	name?: string;
	workspaceId: string;
}

export type RenameWorkspaceStatus = 'failure' | 'success';

export interface RenameWorkspaceResult {
	diagnostics: RenameWorkspaceDiagnostic[];
	status: RenameWorkspaceStatus;
	workspace: CreatedWorkspaceSnapshot | null;
}

/**
 * Lifecycle archive of a workspace. Preserves the `.context/` directory under
 * `<root>/archived-contexts/`, records an archive snapshot for later script
 * hooks (PID-038) and after-merge cleanup (PID-060), and stamps
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

export type ArchiveWorkspaceDiagnosticSeverity = 'error' | 'info' | 'warning';

export interface ArchiveWorkspaceDiagnostic {
	code: ArchiveWorkspaceDiagnosticCode;
	message: string;
	path?: string;
	severity: ArchiveWorkspaceDiagnosticSeverity;
}

export interface ArchiveWorkspaceRequest {
	branchCleanup?: boolean;
	reason?: string;
	workspaceId: string;
}

export type ArchiveWorkspaceStatus = 'aborted' | 'failure' | 'success';

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

export type DeleteWorkspaceDiagnosticSeverity = 'error' | 'info' | 'warning';

export interface DeleteWorkspaceDiagnostic {
	code: DeleteWorkspaceDiagnosticCode;
	message: string;
	path?: string;
	severity: DeleteWorkspaceDiagnosticSeverity;
}

export interface DeleteWorkspaceRequest {
	workspaceId: string;
}

export type DeleteWorkspaceStatus = 'failure' | 'success';

export interface DeletedWorkspaceSnapshot {
	branchName: string | null;
	id: string;
	name: string;
	path: string;
	repositoryId: string;
}

export interface DeleteWorkspaceResult {
	branchDeleted: boolean;
	diagnostics: DeleteWorkspaceDiagnostic[];
	pathRemoved: boolean;
	status: DeleteWorkspaceStatus;
	workspace: DeletedWorkspaceSnapshot | null;
}

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

export type UnarchiveWorkspaceDiagnosticSeverity = 'error' | 'info' | 'warning';

export interface UnarchiveWorkspaceDiagnostic {
	code: UnarchiveWorkspaceDiagnosticCode;
	message: string;
	path?: string;
	severity: UnarchiveWorkspaceDiagnosticSeverity;
}

export interface UnarchiveWorkspaceRequest {
	reason?: string;
	workspaceId: string;
}

export type UnarchiveWorkspaceStatus = 'aborted' | 'failure' | 'success';

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

export type DeleteArchivedWorkspaceDiagnosticSeverity =
	| 'error'
	| 'info'
	| 'warning';

export interface DeleteArchivedWorkspaceDiagnostic {
	code: DeleteArchivedWorkspaceDiagnosticCode;
	message: string;
	path?: string;
	severity: DeleteArchivedWorkspaceDiagnosticSeverity;
}

export interface DeleteArchivedWorkspaceRequest {
	workspaceId: string;
}

export type DeleteArchivedWorkspaceStatus = 'failure' | 'success';

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

export interface ListArchivedWorkspacesRequest {
	repositoryId: string;
}

export interface ListArchivedWorkspacesResult {
	entries: ArchivedWorkspaceListEntry[];
	repositoryId: string;
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
