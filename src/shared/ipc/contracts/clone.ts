import type { RegisteredRepositorySnapshot } from './repository';

/** Stable diagnostic code for GitHub clone preparation and execution failures. */
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

/** Severity level for a GitHub clone diagnostic. */
export type CloneGithubRepositoryDiagnosticSeverity =
	| 'error'
	| 'info'
	| 'warning';

/** A diagnostic surfaced while preparing or running a GitHub clone. */
export interface CloneGithubRepositoryDiagnostic {
	code: CloneGithubRepositoryDiagnosticCode;
	message: string;
	path?: string;
	severity: CloneGithubRepositoryDiagnosticSeverity;
}

/** Request to prepare a GitHub repository clone from a URL. */
export interface CloneGithubRepositoryRequest {
	destinationPath?: string;
	url: string;
}

/** Validated clone plan produced by the prepare step, resolved before the clone runs. */
export interface CloneGithubRepositoryPreparation {
	defaultParentPath: string;
	jobId: string;
	repositoryName: string;
	sanitizedUrl: string;
	targetPath: string;
	validatedUrl: string;
}

/** Result of preparing a clone: the validated preparation on success, or diagnostics on failure. */
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

/** Request to start a prepared clone job, keyed by its job id. */
export interface CloneGithubRepositoryStartRequest {
	jobId: string;
}

/** Channel a clone progress line came from: stdout, stderr, or a status update. */
export type CloneGithubRepositoryProgressKind = 'stderr' | 'status' | 'stdout';

/** A single progress line emitted while a clone job runs. */
export interface CloneGithubRepositoryProgressEvent {
	jobId: string;
	kind: CloneGithubRepositoryProgressKind;
	text: string;
	timestamp: string;
}

/** Terminal status of a clone job. */
export type CloneGithubRepositoryStartStatus = 'failure' | 'success';

/** Result of running a clone job: the registered repository plus logs and diagnostics. */
export interface CloneGithubRepositoryStartResult {
	diagnostics: CloneGithubRepositoryDiagnostic[];
	jobId: string;
	logs: CloneGithubRepositoryProgressEvent[];
	repository: RegisteredRepositorySnapshot | null;
	status: CloneGithubRepositoryStartStatus;
	targetPath: string;
}

/** Result of the native folder picker for choosing a clone destination. */
export interface CloneDestinationSelectionResult {
	canceled: boolean;
	error?: string;
	path?: string;
}

/** A GitHub repository listed in the clone picker. */
export interface GithubRepositoryEntry {
	avatarUrl: string | null;
	description: string | null;
	fullName: string;
	isPrivate: boolean;
	ownerLogin: string;
	updatedAt: string;
}

/** How much of the repository list to fetch: recently updated or the full set. */
export type GithubRepositoryListScope = 'full' | 'recent';

/** Request to list the authenticated user's GitHub repositories. */
export interface GithubRepositoryListRequest {
	scope?: GithubRepositoryListScope;
}

/** Outcome status of a GitHub repository listing. */
export type GithubRepositoryListStatus = 'failure' | 'success';

/** Result of listing GitHub repositories, with entries and a generation timestamp. */
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
