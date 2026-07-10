import type { AdoptedRepositorySnapshot } from './repository';
import type { AdoptedWorkspaceSnapshot } from './workspace';

/** Overall status of a shared-root adoption scan. */
export type SharedRootAdoptionStatus = 'error' | 'ok' | 'warning';

/** Severity of a shared-root adoption diagnostic. */
export type SharedRootAdoptionDiagnosticSeverity = 'error' | 'info' | 'warning';

/** Machine code identifying a specific shared-root adoption problem. */
export type SharedRootAdoptionDiagnosticCode =
	| 'database-unavailable'
	| 'invalid-repository'
	| 'invalid-worktree'
	| 'repository-scan-failed'
	| 'root-unavailable'
	| 'workspace-branch-collision'
	| 'workspace-orphaned'
	| 'workspace-scan-failed'
	| 'worktree-repository-mismatch';

/** A single problem found while scanning and reconciling the shared root. */
export interface SharedRootAdoptionDiagnostic {
	code: SharedRootAdoptionDiagnosticCode;
	message: string;
	path?: string;
	severity: SharedRootAdoptionDiagnosticSeverity;
}

/** A previously adopted repository whose path is now missing. */
export interface SharedRootAdoptionStaleRepositoryRecord {
	id: string;
	missingSince: string;
	path: string;
}

/** A previously adopted workspace whose path is now missing. */
export interface SharedRootAdoptionStaleWorkspaceRecord {
	id: string;
	missingSince: string;
	path: string;
}

/** Result of scanning the shared root: adopted, refreshed, and stale records plus diagnostics. */
export interface SharedRootAdoptionSnapshot {
	adopted: {
		repositories: AdoptedRepositorySnapshot[];
		workspaces: AdoptedWorkspaceSnapshot[];
	};
	diagnostics: SharedRootAdoptionDiagnostic[];
	refreshed: {
		repositoryIds: string[];
		workspaceIds: string[];
	};
	rootPath: string;
	scannedAt: string;
	stale: {
		repositories: SharedRootAdoptionStaleRepositoryRecord[];
		workspaces: SharedRootAdoptionStaleWorkspaceRecord[];
	};
	status: SharedRootAdoptionStatus;
}

/** Shared-root adoption / reconciliation IPC surface. */
export interface SharedRootApi {
	sharedRootAdoption: () => Promise<SharedRootAdoptionSnapshot>;
}
