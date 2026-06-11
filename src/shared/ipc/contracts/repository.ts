import type { RepositoryConfigSourceSnapshot } from './repository-config';

export type RegisterLocalRepositoryDiagnosticSeverity =
	| 'error'
	| 'info'
	| 'warning';

export type RegisterLocalRepositoryDiagnosticCode =
	| 'database-unavailable'
	| 'path-not-a-git-repository'
	| 'repository-already-registered'
	| 'repository-insert-failed'
	| 'repository-path-is-workspace'
	| 'repository-path-missing'
	| 'repository-path-relative'
	| 'repository-path-unreadable'
	| 'repository-permission-denied'
	| 'repository-remote-already-registered';

export interface RegisterLocalRepositoryDiagnostic {
	code: RegisterLocalRepositoryDiagnosticCode;
	message: string;
	path?: string;
	severity: RegisterLocalRepositoryDiagnosticSeverity;
}

export interface RegisteredRepositorySnapshot {
	createdAt: string;
	defaultBranch: string | null;
	id: string;
	metadata: Record<string, unknown>;
	name: string;
	path: string;
	remoteUrl: string | null;
	slug: string;
	updatedAt: string;
}

export interface RegisterLocalRepositoryRequest {
	/**
	 * Optional logical name for the repository row. When omitted, the basename
	 * of the path is used. Callers like `clone` and `quick-start` set this so a
	 * folder suffix (`haartz-next-2`) does not bleed into the displayed name.
	 */
	name?: string;
	path: string;
}

export interface RegisterLocalRepositoryResult {
	diagnostics: RegisterLocalRepositoryDiagnostic[];
	registered: boolean;
	repository: RegisteredRepositorySnapshot | null;
	settingsSources: RepositoryConfigSourceSnapshot[];
}

export interface LocalRepositorySelectionResult {
	canceled: boolean;
	error?: string;
	path?: string;
}

/**
 * Lifecycle archive of a repository. Sets `repositories.archived_at`, archives
 * every child workspace through the same hook pipeline as a standalone
 * workspace archive, and records the lifecycle decision so ENS-038 / ENS-060
 * subscribers can act on it later. Worktree folders and branches are preserved
 * unless the request opts into `branchCleanup` (and each workspace already
 * confirmed that choice upstream).
 */
export type ArchiveRepositoryDiagnosticCode =
	| 'archive-aborted-by-hook'
	| 'database-unavailable'
	| 'lifecycle-hook-failed'
	| 'repository-already-archived'
	| 'repository-id-required'
	| 'repository-not-found'
	| 'repository-update-failed'
	| 'workspace-archive-failed';

export type ArchiveRepositoryDiagnosticSeverity = 'error' | 'info' | 'warning';

export interface ArchiveRepositoryDiagnostic {
	code: ArchiveRepositoryDiagnosticCode;
	message: string;
	path?: string;
	severity: ArchiveRepositoryDiagnosticSeverity;
	workspaceId?: string;
}

export interface ArchiveRepositoryRequest {
	branchCleanup?: boolean;
	reason?: string;
	repositoryId: string;
}

export type ArchiveRepositoryStatus = 'aborted' | 'failure' | 'success';

export interface ArchivedRepositorySnapshot {
	archivedAt: string;
	archivedWorkspaceIds: string[];
	id: string;
	name: string;
	path: string;
	slug: string;
}

export interface ArchiveRepositoryResult {
	archiveRecordId: string | null;
	diagnostics: ArchiveRepositoryDiagnostic[];
	repository: ArchivedRepositorySnapshot | null;
	status: ArchiveRepositoryStatus;
	workspacesArchived: number;
}

/**
 * Destructive removal of a repository and all its workspaces. Wipes worktrees,
 * drops branches, deletes rows, and writes the `.ensemble-archived` sentinel
 * so the shared-root reconciler skips the still-on-disk folder on next launch.
 */
export type DeleteRepositoryDiagnosticCode =
	| 'database-unavailable'
	| 'repository-delete-failed'
	| 'repository-id-required'
	| 'repository-not-found'
	| 'workspace-cleanup-failed';

export type DeleteRepositoryDiagnosticSeverity = 'error' | 'info' | 'warning';

export interface DeleteRepositoryDiagnostic {
	code: DeleteRepositoryDiagnosticCode;
	message: string;
	path?: string;
	severity: DeleteRepositoryDiagnosticSeverity;
	workspaceId?: string;
}

export interface DeleteRepositoryRequest {
	repositoryId: string;
}

export type DeleteRepositoryStatus = 'failure' | 'success';

export interface DeletedRepositorySnapshot {
	deletedWorkspaceIds: string[];
	id: string;
	name: string;
	path: string;
}

export interface DeleteRepositoryResult {
	diagnostics: DeleteRepositoryDiagnostic[];
	repository: DeletedRepositorySnapshot | null;
	status: DeleteRepositoryStatus;
	workspacesDeleted: number;
}

export interface AdoptedRepositorySnapshot {
	adoptedAt: string;
	createdAt: string;
	defaultBranch: string | null;
	id: string;
	metadata: Record<string, unknown>;
	name: string;
	path: string;
	remoteUrl: string | null;
	slug: string;
	updatedAt: string;
}

/** Repository lifecycle IPC surface (register / hard-delete / selection dialog). */
export interface RepositoryApi {
	deleteRepository: (
		request: DeleteRepositoryRequest,
	) => Promise<DeleteRepositoryResult>;
	registerLocalRepository: (
		request: RegisterLocalRepositoryRequest,
	) => Promise<RegisterLocalRepositoryResult>;
	selectLocalRepository: () => Promise<LocalRepositorySelectionResult>;
}
