import type { RegisteredRepositorySnapshot } from './repository';

export type CloneGithubRepositoryDiagnosticCode =
	| 'auth'
	| 'destination-exists'
	| 'destination-not-writable'
	| 'destination-path-relative'
	| 'destination-required'
	| 'git-failed'
	| 'git-not-installed'
	| 'job-unknown'
	| 'network'
	| 'permission'
	| 'register-failed'
	| 'remote-already-registered'
	| 'repository-not-found'
	| 'spawn-error'
	| 'unsupported-host'
	| 'url-invalid'
	| 'url-required';

export type CloneGithubRepositoryDiagnosticSeverity =
	| 'error'
	| 'info'
	| 'warning';

export interface CloneGithubRepositoryDiagnostic {
	code: CloneGithubRepositoryDiagnosticCode;
	message: string;
	path?: string;
	severity: CloneGithubRepositoryDiagnosticSeverity;
}

export interface CloneGithubRepositoryRequest {
	destinationPath?: string;
	url: string;
}

export interface CloneGithubRepositoryPreparation {
	defaultParentPath: string;
	jobId: string;
	repositoryName: string;
	sanitizedUrl: string;
	targetPath: string;
	validatedUrl: string;
}

export type CloneGithubRepositoryPrepareResult =
	| {
			diagnostics: CloneGithubRepositoryDiagnostic[];
			ok: false;
	  }
	| {
			diagnostics: CloneGithubRepositoryDiagnostic[];
			ok: true;
			preparation: CloneGithubRepositoryPreparation;
	  };

export interface CloneGithubRepositoryStartRequest {
	jobId: string;
}

export type CloneGithubRepositoryProgressKind = 'stderr' | 'status' | 'stdout';

export interface CloneGithubRepositoryProgressEvent {
	jobId: string;
	kind: CloneGithubRepositoryProgressKind;
	text: string;
	timestamp: string;
}

export type CloneGithubRepositoryStartStatus = 'failure' | 'success';

export interface CloneGithubRepositoryStartResult {
	diagnostics: CloneGithubRepositoryDiagnostic[];
	jobId: string;
	logs: CloneGithubRepositoryProgressEvent[];
	repository: RegisteredRepositorySnapshot | null;
	status: CloneGithubRepositoryStartStatus;
	targetPath: string;
}

export interface CloneDestinationSelectionResult {
	canceled: boolean;
	error?: string;
	path?: string;
}

export interface GithubRepositoryEntry {
	avatarUrl: string | null;
	description: string | null;
	fullName: string;
	isPrivate: boolean;
	ownerLogin: string;
	updatedAt: string;
}

export type GithubRepositoryListScope = 'full' | 'recent';

export interface GithubRepositoryListRequest {
	scope?: GithubRepositoryListScope;
}

export type GithubRepositoryListStatus = 'failure' | 'success';

export interface GithubRepositoryListResult {
	entries: GithubRepositoryEntry[];
	error?: string;
	generatedAt: string;
	status: GithubRepositoryListStatus;
}

/** GitHub clone / discovery IPC surface, including the live progress channel. */
export interface CloneApi {
	githubRepositoryList: (
		request?: GithubRepositoryListRequest,
	) => Promise<GithubRepositoryListResult>;
	onCloneGithubRepositoryProgress: (
		listener: (event: CloneGithubRepositoryProgressEvent) => void,
	) => () => void;
	prepareCloneGithubRepository: (
		request: CloneGithubRepositoryRequest,
	) => Promise<CloneGithubRepositoryPrepareResult>;
	selectCloneDestination: () => Promise<CloneDestinationSelectionResult>;
	startCloneGithubRepository: (
		request: CloneGithubRepositoryStartRequest,
	) => Promise<CloneGithubRepositoryStartResult>;
}
