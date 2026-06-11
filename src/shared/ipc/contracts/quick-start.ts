import type { RegisteredRepositorySnapshot } from './repository';

export type QuickStartProjectDiagnosticCode =
	| 'destination-exists'
	| 'destination-not-writable'
	| 'destination-path-relative'
	| 'destination-required'
	| 'git-init-failed'
	| 'git-not-installed'
	| 'mkdir-failed'
	| 'name-already-in-use'
	| 'name-invalid'
	| 'name-required'
	| 'register-failed';

export type QuickStartProjectDiagnosticSeverity = 'error' | 'info' | 'warning';

export interface QuickStartProjectDiagnostic {
	code: QuickStartProjectDiagnosticCode;
	message: string;
	path?: string;
	severity: QuickStartProjectDiagnosticSeverity;
}

export interface QuickStartProjectRequest {
	name: string;
	parentPath?: string;
}

export type QuickStartProjectStatus = 'failure' | 'success';

export interface QuickStartProjectResult {
	diagnostics: QuickStartProjectDiagnostic[];
	repository: RegisteredRepositorySnapshot | null;
	status: QuickStartProjectStatus;
	targetPath: string;
}

/** Quick-start project scaffolding IPC surface. */
export interface QuickStartApi {
	quickStartProject: (
		request: QuickStartProjectRequest,
	) => Promise<QuickStartProjectResult>;
}
