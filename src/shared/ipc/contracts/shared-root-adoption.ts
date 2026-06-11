import type { AdoptedRepositorySnapshot } from './repository';
import type { AdoptedWorkspaceSnapshot } from './workspace';

export type SharedRootAdoptionStatus = 'error' | 'ok' | 'warning';

export type SharedRootAdoptionDiagnosticSeverity = 'error' | 'info' | 'warning';

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

export interface SharedRootAdoptionDiagnostic {
	code: SharedRootAdoptionDiagnosticCode;
	message: string;
	path?: string;
	severity: SharedRootAdoptionDiagnosticSeverity;
}

export interface SharedRootAdoptionStaleRepositoryRecord {
	id: string;
	missingSince: string;
	path: string;
}

export interface SharedRootAdoptionStaleWorkspaceRecord {
	id: string;
	missingSince: string;
	path: string;
}

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
