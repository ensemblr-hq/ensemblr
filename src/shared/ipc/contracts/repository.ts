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

export type ArchiveRepositoryDiagnosticCode =
	| 'database-unavailable'
	| 'repository-delete-failed'
	| 'repository-id-required'
	| 'repository-not-found'
	| 'workspace-cleanup-failed';

export type ArchiveRepositoryDiagnosticSeverity = 'error' | 'info' | 'warning';

export interface ArchiveRepositoryDiagnostic {
	code: ArchiveRepositoryDiagnosticCode;
	message: string;
	path?: string;
	severity: ArchiveRepositoryDiagnosticSeverity;
	workspaceId?: string;
}

export interface ArchiveRepositoryRequest {
	repositoryId: string;
}

export type ArchiveRepositoryStatus = 'failure' | 'success';

/** Subset of the archived repository surfaced to the renderer for confirmation copy. */
export interface ArchivedRepositorySnapshot {
	archivedWorkspaceIds: string[];
	id: string;
	name: string;
	path: string;
}

export interface ArchiveRepositoryResult {
	diagnostics: ArchiveRepositoryDiagnostic[];
	repository: ArchivedRepositorySnapshot | null;
	status: ArchiveRepositoryStatus;
	workspacesArchived: number;
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
