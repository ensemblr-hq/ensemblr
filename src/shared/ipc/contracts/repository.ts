import type { RepositoryConfigSourceSnapshot } from './repository-config';

/** Severity level of a local-repository registration diagnostic. */
export type RegisterLocalRepositoryDiagnosticSeverity =
	| 'error'
	| 'info'
	| 'warning';

/** Machine-readable codes for failures and warnings raised while registering a local repository. */
export type RegisterLocalRepositoryDiagnosticCode =
	| 'database-unavailable'
	| 'destination-not-writable'
	| 'managed-repositories-path-missing'
	| 'path-not-a-git-repository'
	| 'repository-already-registered'
	| 'repository-copy-failed'
	| 'repository-copy-target-inside-source'
	| 'repository-insert-failed'
	| 'repository-path-is-workspace'
	| 'repository-path-missing'
	| 'repository-path-not-directory'
	| 'repository-path-relative'
	| 'repository-path-unreadable'
	| 'repository-permission-denied'
	| 'repository-remote-already-registered';

/** A single diagnostic emitted while registering a local repository. */
export interface RegisterLocalRepositoryDiagnostic {
	code: RegisterLocalRepositoryDiagnosticCode;
	message: string;
	path?: string;
	severity: RegisterLocalRepositoryDiagnosticSeverity;
}

/** Wire snapshot of a registered repository row. */
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

/** Request to register or import a local git repository. */
export interface RegisterLocalRepositoryRequest {
	/**
	 * Optional logical name for the repository row. When omitted, the basename
	 * of the path is used. Callers like `clone` and `quick-start` set this so a
	 * folder suffix (`haartz-next-2`) does not bleed into the displayed name.
	 */
	name?: string;
	path: string;
}

/** Result of registering a local repository, with diagnostics and resolved settings sources. */
export interface RegisterLocalRepositoryResult {
	diagnostics: RegisterLocalRepositoryDiagnostic[];
	registered: boolean;
	repository: RegisteredRepositorySnapshot | null;
	settingsSources: RepositoryConfigSourceSnapshot[];
}

/** Result of prompting the user to pick a local repository folder. */
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

/** Severity level of a repository-archive diagnostic. */
export type ArchiveRepositoryDiagnosticSeverity = 'error' | 'info' | 'warning';

/** A single diagnostic emitted while archiving a repository. */
export interface ArchiveRepositoryDiagnostic {
	code: ArchiveRepositoryDiagnosticCode;
	message: string;
	path?: string;
	severity: ArchiveRepositoryDiagnosticSeverity;
	workspaceId?: string;
}

/** Request to archive a repository and its workspaces. */
export interface ArchiveRepositoryRequest {
	branchCleanup?: boolean;
	reason?: string;
	repositoryId: string;
}

/** Outcome status of a repository-archive attempt. */
export type ArchiveRepositoryStatus = 'aborted' | 'failure' | 'success';

/** Wire snapshot of a repository after it has been archived. */
export interface ArchivedRepositorySnapshot {
	archivedAt: string;
	archivedWorkspaceIds: string[];
	id: string;
	name: string;
	path: string;
	slug: string;
}

/** Result of archiving a repository, with diagnostics and the count of archived workspaces. */
export interface ArchiveRepositoryResult {
	archiveRecordId: string | null;
	diagnostics: ArchiveRepositoryDiagnostic[];
	repository: ArchivedRepositorySnapshot | null;
	status: ArchiveRepositoryStatus;
	workspacesArchived: number;
}

/**
 * Destructive removal of a repository and all its workspaces. Wipes worktrees,
 * drops branches, deletes rows, and writes the `.ensemblr-archived` sentinel
 * so the shared-root reconciler skips the still-on-disk folder on next launch.
 */
export type DeleteRepositoryDiagnosticCode =
	| 'database-unavailable'
	| 'repository-delete-failed'
	| 'repository-id-required'
	| 'repository-not-found'
	| 'workspace-cleanup-failed';

/** Severity level of a repository-delete diagnostic. */
export type DeleteRepositoryDiagnosticSeverity = 'error' | 'info' | 'warning';

/** A single diagnostic emitted while deleting a repository. */
export interface DeleteRepositoryDiagnostic {
	code: DeleteRepositoryDiagnosticCode;
	message: string;
	path?: string;
	severity: DeleteRepositoryDiagnosticSeverity;
	workspaceId?: string;
}

/** Request to permanently delete a repository and its workspaces. */
export interface DeleteRepositoryRequest {
	repositoryId: string;
}

/** Outcome status of a repository-delete attempt. */
export type DeleteRepositoryStatus = 'failure' | 'success';

/** Wire snapshot of a repository after it has been deleted. */
export interface DeletedRepositorySnapshot {
	deletedWorkspaceIds: string[];
	id: string;
	name: string;
	path: string;
}

/** Result of deleting a repository, with diagnostics and the count of deleted workspaces. */
export interface DeleteRepositoryResult {
	diagnostics: DeleteRepositoryDiagnostic[];
	repository: DeletedRepositorySnapshot | null;
	status: DeleteRepositoryStatus;
	workspacesDeleted: number;
}

/** Wire snapshot of a repository adopted into the database from an existing on-disk folder. */
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

/** Repository lifecycle IPC surface (import/register / hard-delete / selection dialog). */
export interface RepositoryApi {
	deleteRepository: (
		request: DeleteRepositoryRequest,
	) => Promise<DeleteRepositoryResult>;
	importLocalRepository: (
		request: RegisterLocalRepositoryRequest,
	) => Promise<RegisterLocalRepositoryResult>;
	registerLocalRepository: (
		request: RegisterLocalRepositoryRequest,
	) => Promise<RegisterLocalRepositoryResult>;
	selectLocalRepository: () => Promise<LocalRepositorySelectionResult>;
}
