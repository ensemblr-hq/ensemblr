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

export type ArchiveWorkspaceDiagnosticCode =
	| 'database-unavailable'
	| 'workspace-delete-failed'
	| 'workspace-id-required'
	| 'workspace-not-found';

export type ArchiveWorkspaceDiagnosticSeverity = 'error' | 'info' | 'warning';

export interface ArchiveWorkspaceDiagnostic {
	code: ArchiveWorkspaceDiagnosticCode;
	message: string;
	path?: string;
	severity: ArchiveWorkspaceDiagnosticSeverity;
}

export interface ArchiveWorkspaceRequest {
	workspaceId: string;
}

export type ArchiveWorkspaceStatus = 'failure' | 'success';

/** Subset of the deleted workspace surfaced to the renderer for confirmation copy. */
export interface ArchivedWorkspaceSnapshot {
	branchName: string | null;
	id: string;
	name: string;
	path: string;
	repositoryId: string;
}

export interface ArchiveWorkspaceResult {
	branchDeleted: boolean;
	diagnostics: ArchiveWorkspaceDiagnostic[];
	pathRemoved: boolean;
	status: ArchiveWorkspaceStatus;
	workspace: ArchivedWorkspaceSnapshot | null;
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
