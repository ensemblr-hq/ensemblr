import type { RegisteredRepositorySnapshot } from './repository';

/** Machine-readable codes for failures and warnings raised while scaffolding a quick-start project. */
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
	| 'publish-failed'
	| 'register-failed';

/** Severity level of a quick-start project diagnostic. */
export type QuickStartProjectDiagnosticSeverity = 'error' | 'info' | 'warning';

/** A single diagnostic emitted while scaffolding a quick-start project. */
export interface QuickStartProjectDiagnostic {
	code: QuickStartProjectDiagnosticCode;
	message: string;
	path?: string;
	severity: QuickStartProjectDiagnosticSeverity;
}

/** Request to scaffold a new quick-start project. */
export interface QuickStartProjectRequest {
	name: string;
	parentPath?: string;
}

/** Outcome status of a quick-start project scaffolding attempt. */
export type QuickStartProjectStatus = 'failure' | 'success';

/** Result of a quick-start scaffolding attempt, with diagnostics and the registered repository. */
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
