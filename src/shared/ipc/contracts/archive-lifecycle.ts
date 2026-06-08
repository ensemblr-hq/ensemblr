/**
 * Shared lifecycle types for archive hook subscribers and downstream archive
 * services. Keep both the renderer (read-only mirror) and main process aligned
 * on the wire shape so a future Pi/archive script subscriber in `PID-038` can
 * be wired without touching the runtime contract.
 */

export type ArchiveLifecycleStage =
	| 'pre-archive-repository'
	| 'pre-archive-workspace'
	| 'pre-unarchive-workspace'
	| 'post-archive-repository'
	| 'post-archive-workspace'
	| 'post-unarchive-workspace';

export type ArchiveLifecycleDiagnosticSeverity = 'error' | 'info' | 'warning';

export interface ArchiveLifecycleDiagnostic {
	code: string;
	message: string;
	path?: string;
	severity: ArchiveLifecycleDiagnosticSeverity;
	/** Stamped automatically by the registry when missing on the handler output. */
	stage?: ArchiveLifecycleStage;
}

export interface ArchiveLifecycleAbort {
	code: string;
	message: string;
}

export interface ArchiveLifecycleOutcome {
	abort?: ArchiveLifecycleAbort;
	diagnostics?: ArchiveLifecycleDiagnostic[];
}

export interface ArchiveLifecycleWorkspaceTarget {
	branchName: string | null;
	id: string;
	name: string;
	path: string;
	repositoryId: string;
	slug: string;
}

export interface ArchiveLifecycleRepositoryTarget {
	id: string;
	name: string;
	path: string;
	slug: string;
}

export interface ArchiveLifecycleContext {
	archivedAt: string;
	archivedContextPath: string | null;
	branchCleanup: boolean;
	repository: ArchiveLifecycleRepositoryTarget;
	stage: ArchiveLifecycleStage;
	workspace: ArchiveLifecycleWorkspaceTarget | null;
}
