import type { GithubFailure } from './github';
import type { RegisteredRepositorySnapshot } from './repository';
import type { RepositoryBranchWire } from './workspace-sources';

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
	/**
	 * Bare branch name to check out, handed to `git clone --branch`. Absent for
	 * the remote's own default, and for a ref `gh` does not list — a tag or
	 * another remote's branch is not a valid `--branch` argument.
	 */
	branch?: string;
	/**
	 * Ref persisted as the cloned repository's `branchFrom` setting, so new
	 * workspaces fork from it. Absent leaves the setting unwritten, which keeps
	 * the repository tracking whatever GitHub's default branch is.
	 */
	branchFrom?: string;
	destinationPath?: string;
	url: string;
}

/** Validated clone plan produced by the prepare step, resolved before the clone runs. */
export interface CloneGithubRepositoryPreparation {
	branch?: string;
	branchFrom?: string;
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

/** Request for a not-yet-cloned repository's remote branches, keyed by its URL. */
export interface GithubRemoteBranchListRequest {
	url: string;
}

/**
 * A repository's remote branches read before it is cloned. Shaped like
 * `ListRepositoryBranchesResult` so the shared branch picker renders either
 * source unchanged; there is no local checkout yet, so every row reports
 * `hasWorkspace: false`.
 */
export type GithubRemoteBranchListResult =
	| { branches: RepositoryBranchWire[]; status: 'ok' }
	| { branches: RepositoryBranchWire[]; error: GithubFailure; status: 'error' };

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
	githubRemoteBranchList: (
		request: GithubRemoteBranchListRequest,
	) => Promise<GithubRemoteBranchListResult>;
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
