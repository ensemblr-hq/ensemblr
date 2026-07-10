/**
 * Shared lifecycle types for archive hook subscribers and downstream archive
 * services. Keep both the renderer (read-only mirror) and main process aligned
 * on the wire shape so a future Pi/archive script subscriber in `ENS-038` can
 * be wired without touching the runtime contract.
 */
import type {
	ArchiveRepositoryRequest,
	ArchiveRepositoryResult,
} from './repository';
import type {
	ArchiveWorkspaceRequest,
	ArchiveWorkspaceResult,
	DeleteArchivedWorkspaceRequest,
	DeleteArchivedWorkspaceResult,
	ListAllWorkspacesResult,
	ListArchivedWorkspacesRequest,
	ListArchivedWorkspacesResult,
	UnarchiveWorkspaceRequest,
	UnarchiveWorkspaceResult,
} from './workspace';

/** Lifecycle phase at which an archive hook fires — pre/post archive or unarchive of a repository or workspace. */
export type ArchiveLifecycleStage =
	| 'pre-archive-repository'
	| 'pre-archive-workspace'
	| 'pre-unarchive-workspace'
	| 'post-archive-repository'
	| 'post-archive-workspace'
	| 'post-unarchive-workspace';

/** Severity level for an archive lifecycle diagnostic. */
export type ArchiveLifecycleDiagnosticSeverity = 'error' | 'info' | 'warning';

/** A diagnostic surfaced by an archive lifecycle handler. */
export interface ArchiveLifecycleDiagnostic {
	code: string;
	message: string;
	path?: string;
	severity: ArchiveLifecycleDiagnosticSeverity;
	/** Stamped automatically by the registry when missing on the handler output. */
	stage?: ArchiveLifecycleStage;
}

/** Signal from a pre-stage handler that aborts the archive operation with a reason. */
export interface ArchiveLifecycleAbort {
	code: string;
	message: string;
}

/** Result returned by an archive lifecycle handler: an optional abort plus any diagnostics. */
export interface ArchiveLifecycleOutcome {
	abort?: ArchiveLifecycleAbort;
	diagnostics?: ArchiveLifecycleDiagnostic[];
}

/** The workspace being archived or unarchived, as passed to lifecycle handlers. */
export interface ArchiveLifecycleWorkspaceTarget {
	branchName: string | null;
	id: string;
	name: string;
	path: string;
	repositoryId: string;
	slug: string;
}

/** The repository being archived, as passed to lifecycle handlers. */
export interface ArchiveLifecycleRepositoryTarget {
	id: string;
	name: string;
	path: string;
	slug: string;
}

/** Context passed to an archive lifecycle handler for a stage, including the target repository and optional workspace. */
export interface ArchiveLifecycleContext {
	archivedAt: string;
	archivedContextPath: string | null;
	branchCleanup: boolean;
	repository: ArchiveLifecycleRepositoryTarget;
	stage: ArchiveLifecycleStage;
	workspace: ArchiveLifecycleWorkspaceTarget | null;
}

/**
 * Archive lifecycle IPC surface — covers archive/unarchive of workspaces and
 * repositories plus the browse-archive listing and permanent purge.
 */
export interface ArchiveApi {
	archiveRepository: (
		request: ArchiveRepositoryRequest,
	) => Promise<ArchiveRepositoryResult>;
	archiveWorkspace: (
		request: ArchiveWorkspaceRequest,
	) => Promise<ArchiveWorkspaceResult>;
	deleteArchivedWorkspace: (
		request: DeleteArchivedWorkspaceRequest,
	) => Promise<DeleteArchivedWorkspaceResult>;
	/** Global History feed: every workspace across all repositories, active or archived. */
	listAllWorkspaces: () => Promise<ListAllWorkspacesResult>;
	listArchivedWorkspaces: (
		request: ListArchivedWorkspacesRequest,
	) => Promise<ListArchivedWorkspacesResult>;
	unarchiveWorkspace: (
		request: UnarchiveWorkspaceRequest,
	) => Promise<UnarchiveWorkspaceResult>;
}
