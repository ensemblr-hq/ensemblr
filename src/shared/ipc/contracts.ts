export type ConfigStatus = 'error' | 'invalid' | 'missing' | 'ok';
export type ConfigDiagnosticSeverity = 'error' | 'info' | 'warning';

export interface ConfigDiagnostic {
	code: string;
	column?: number;
	fieldPath?: string;
	line?: number;
	message: string;
	severity: ConfigDiagnosticSeverity;
}

export interface ConfigStatusSnapshot {
	blocksReadiness: boolean;
	diagnostics: ConfigDiagnostic[];
	displayPath: string;
	loadedAt: string;
	path: string;
	schemaVersion: number | null;
	status: ConfigStatus;
}

export interface HealthSnapshot {
	appName: string;
	config: ConfigStatusSnapshot;
	database: {
		error?: string;
		path: string;
		schemaVersion: number;
		status: 'ok' | 'error';
	};
	platform: string;
	status: 'ok';
	timestamp: string;
	versions: {
		chrome: string;
		electron: string;
		node: string;
	};
}

export type SettingsResolutionScope = 'app' | 'repository';
export type SettingsResolutionSource =
	| 'built-in-default'
	| 'conductor-config'
	| 'conductor-legacy-config'
	| 'conductor-local-config'
	| 'config-default'
	| 'managed-config'
	| 'ensemble-config'
	| 'sqlite'
	| 'worktreeinclude';
export type SettingsResolutionCandidateStatus =
	| 'ignored'
	| 'invalid'
	| 'selected';

export interface SettingResolutionCandidateSnapshot {
	reason: string;
	source: SettingsResolutionSource;
	status: SettingsResolutionCandidateStatus;
}

export interface ResolvedSettingSnapshot {
	candidates: SettingResolutionCandidateSnapshot[];
	key: string;
	locked: boolean;
	source: SettingsResolutionSource;
	value: unknown;
}

export interface SettingsResolutionDiagnostic {
	key: string;
	message: string;
	scope: SettingsResolutionScope;
	source: SettingsResolutionSource;
	status: SettingsResolutionCandidateStatus;
}

export interface SettingsResolutionGroupSnapshot {
	diagnostics: SettingsResolutionDiagnostic[];
	settings: ResolvedSettingSnapshot[];
}

export interface RepositorySettingsResolutionRequest {
	conductorConfig?: Record<string, unknown>;
	ensembleConfig?: Record<string, unknown>;
	repositoryId: string;
	repositoryPath?: string;
}

export interface SettingsResolutionRequest {
	repository?: RepositorySettingsResolutionRequest;
}

export interface SettingsResolutionSnapshot {
	app: SettingsResolutionGroupSnapshot;
	repository?: SettingsResolutionGroupSnapshot;
}

export type RepositoryConfigSourceStatus =
	| 'ignored'
	| 'invalid'
	| 'loaded'
	| 'missing';

export interface RepositoryConfigSourceSnapshot {
	displayPath: string;
	path: string;
	settings: Record<string, unknown>;
	source: SettingsResolutionSource;
	status: RepositoryConfigSourceStatus;
}

export interface RepositoryConfigSnapshot {
	diagnostics: ConfigDiagnostic[];
	loadedAt: string;
	repositoryPath: string;
	sources: RepositoryConfigSourceSnapshot[];
}

export interface RepositoryConfigRequest {
	repositoryPath: string;
}

export type RepositoryConfigMigrationChangeStatus =
	| 'added'
	| 'conflict'
	| 'overwritten'
	| 'unchanged';

export interface RepositoryConfigMigrationChange {
	existingValue?: unknown;
	incomingValue: unknown;
	key: string;
	source: SettingsResolutionSource;
	status: RepositoryConfigMigrationChangeStatus;
}

export interface RepositoryConfigMigrationRequest {
	overwrite?: boolean;
	repositoryPath: string;
}

export interface RepositoryConfigMigrationPreview {
	canApply: boolean;
	changes: RepositoryConfigMigrationChange[];
	diagnostics: ConfigDiagnostic[];
	repositoryPath: string;
	resultingConfig: Record<string, unknown>;
	sourcePath: string | null;
	targetExists: boolean;
	targetPath: string;
}

export interface RepositoryConfigMigrationResult
	extends RepositoryConfigMigrationPreview {
	applied: boolean;
	error?: string;
}

export interface RepositoryWorkspaceNavigationMetadata {
	[key: string]: unknown;
}

export interface RepositoryWorkspaceNavigationWorkspace {
	archivedAt: string | null;
	baseBranch: string | null;
	branchName: string | null;
	createdAt: string;
	id: string;
	metadata: RepositoryWorkspaceNavigationMetadata;
	name: string;
	path: string;
	repositoryId: string;
	slug: string;
	updatedAt: string;
}

export interface RepositoryWorkspaceNavigationRepository {
	createdAt: string;
	defaultBranch: string | null;
	id: string;
	metadata: RepositoryWorkspaceNavigationMetadata;
	name: string;
	path: string;
	slug: string;
	updatedAt: string;
	workspaces: RepositoryWorkspaceNavigationWorkspace[];
}

export interface RepositoryWorkspaceNavigationSnapshot {
	generatedAt: string;
	repositories: RepositoryWorkspaceNavigationRepository[];
}

export type CreateWorkspaceDiagnosticCode =
	| 'context-directory-failed'
	| 'database-unavailable'
	| 'destination-exists'
	| 'destination-not-writable'
	| 'git-not-installed'
	| 'git-worktree-failed'
	| 'name-invalid'
	| 'repositories-path-missing'
	| 'repository-id-required'
	| 'repository-not-found'
	| 'workspace-insert-failed';

export type CreateWorkspaceDiagnosticSeverity = 'error' | 'info' | 'warning';

export interface CreateWorkspaceDiagnostic {
	code: CreateWorkspaceDiagnosticCode;
	message: string;
	path?: string;
	severity: CreateWorkspaceDiagnosticSeverity;
}

export interface CreateWorkspaceRequest {
	baseBranch?: string;
	branchName?: string;
	name?: string;
	repositoryId: string;
}

export interface CreatedWorkspaceSnapshot {
	archivedAt: string | null;
	baseBranch: string | null;
	branchName: string | null;
	createdAt: string;
	id: string;
	metadata: Record<string, unknown>;
	name: string;
	path: string;
	repositoryId: string;
	slug: string;
	updatedAt: string;
}

export type CreateWorkspaceStatus = 'failure' | 'success';

export interface CreateWorkspaceResult {
	diagnostics: CreateWorkspaceDiagnostic[];
	status: CreateWorkspaceStatus;
	workspace: CreatedWorkspaceSnapshot | null;
}

export type EnvironmentVariableScope = 'app' | 'repository' | 'workspace';
export type EnvironmentVariableValueKind = 'plain' | 'runtime' | 'secret';
export type EnvironmentVariableStatus =
	| 'invalid'
	| 'masked'
	| 'reserved'
	| 'set'
	| 'unset';
export type EnvironmentVariableCategory =
	| 'custom'
	| 'generic'
	| 'pi'
	| 'provider'
	| 'proxy'
	| 'runtime';
export type EnvironmentVariableDiagnosticSeverity =
	| 'error'
	| 'info'
	| 'warning';
export type EnvironmentVariableSource =
	| SettingsResolutionSource
	| 'runtime'
	| 'secret-metadata';

export interface EnvironmentVariableCatalogEntrySnapshot {
	category: EnvironmentVariableCategory;
	description: string;
	key: string;
	required: boolean;
	reserved: boolean;
	scope: EnvironmentVariableScope;
	title: string;
	valueKind: EnvironmentVariableValueKind;
}

export interface EnvironmentVariableDiagnostic {
	code: string;
	key?: string;
	message: string;
	severity: EnvironmentVariableDiagnosticSeverity;
}

export interface EnvironmentVariableSnapshot {
	catalog: EnvironmentVariableCatalogEntrySnapshot;
	characterCount?: number;
	displayValue?: string;
	key: string;
	maskedDisplay?: string;
	required: boolean;
	scope: EnvironmentVariableScope;
	scopeId: string;
	source: EnvironmentVariableSource | null;
	status: EnvironmentVariableStatus;
	valueKind: EnvironmentVariableValueKind;
}

export interface EnvironmentVariablesSnapshot {
	catalog: EnvironmentVariableCatalogEntrySnapshot[];
	diagnostics: EnvironmentVariableDiagnostic[];
	generatedAt: string;
	missingRequiredCount: number;
	requiredCount: number;
	variables: EnvironmentVariableSnapshot[];
}

export type RootDirectoryStatus = 'error' | 'ok' | 'warning';
export type RootDirectoryDiagnosticSeverity = 'error' | 'info' | 'warning';
export type RootDirectoryManagedPathKey =
	| 'archived-contexts'
	| 'repos'
	| 'workspaces';
export type RootDirectoryManagedPathStatus =
	| 'created'
	| 'invalid'
	| 'missing'
	| 'present';

export interface RootDirectoryDiagnostic {
	code: string;
	message: string;
	path?: string;
	severity: RootDirectoryDiagnosticSeverity;
}

export interface RootDirectoryManagedPathSnapshot {
	key: RootDirectoryManagedPathKey;
	path: string;
	status: RootDirectoryManagedPathStatus;
}

export interface RootDirectorySnapshot {
	archivedContextsPath: string;
	createdPaths: string[];
	diagnostics: RootDirectoryDiagnostic[];
	managedPaths: RootDirectoryManagedPathSnapshot[];
	path: string;
	repositoriesPath: string;
	setting: ResolvedSettingSnapshot | null;
	source: SettingsResolutionSource | null;
	status: RootDirectoryStatus;
	workspacesPath: string;
}

export type RootDirectoryReconciliationStatus = 'error' | 'ok' | 'warning';

export interface RootDirectoryReconciliationSnapshot {
	diagnostics: RootDirectoryDiagnostic[];
	repositoryDirectoryCount: number;
	scannedAt: string;
	status: RootDirectoryReconciliationStatus;
	workspaceDirectoryCount: number;
}

export interface RootDirectoryChangePreview {
	canApply: boolean;
	diagnostics: RootDirectoryDiagnostic[];
	newRoot: RootDirectorySnapshot;
	oldRoot: RootDirectorySnapshot | null;
	oldRootPreserved: true;
}

export interface RootDirectorySelectionResult {
	canceled: boolean;
	error?: string;
	preview?: RootDirectoryChangePreview;
}

export interface RootDirectoryChangeRequest {
	path: string;
}

export interface RootDirectoryChangeApplyResult {
	applied: boolean;
	error?: string;
	newRoot: RootDirectorySnapshot | null;
	oldRoot: RootDirectorySnapshot | null;
	oldRootPreserved: true;
	reconciliation: RootDirectoryReconciliationSnapshot | null;
}

export type SetupDiagnosticsStatus = 'blocked' | 'checking' | 'ready';
export type SetupCheckGroupId = 'core' | 'github' | 'linear' | 'pi' | 'storage';
export type SetupCheckId =
	| 'config'
	| 'environment-variables'
	| 'gh-auth'
	| 'gh-cli'
	| 'git-executable'
	| 'linear-oauth'
	| 'managed-directories'
	| 'pi-agent-directory'
	| 'pi-executable'
	| 'pi-provider-model'
	| 'pi-rpc'
	| 'root-directory'
	| 'shell-process-launch'
	| 'sqlite-database';
export type SetupCheckStatus =
	| 'failure'
	| 'pending'
	| 'running'
	| 'success'
	| 'warning';
export type SetupRemediationActionKind =
	| 'open-external'
	| 'open-settings'
	| 'retry'
	| 'run-command'
	| 'select-path';

export interface SetupRemediationAction {
	command?: string;
	id: string;
	kind: SetupRemediationActionKind;
	label: string;
	target?: string;
}

export interface SetupCheckLogSnapshot {
	label: string;
	text: string;
	truncated?: boolean;
}

export interface SetupCheckSnapshot {
	blocking: boolean;
	description: string;
	detail: string;
	group: SetupCheckGroupId;
	id: SetupCheckId;
	logs: SetupCheckLogSnapshot[];
	remediationActions: SetupRemediationAction[];
	status: SetupCheckStatus;
	title: string;
	updatedAt: string;
}

export interface SetupDiagnosticsSnapshot {
	blockedCount: number;
	checks: SetupCheckSnapshot[];
	generatedAt: string;
	optionalCount: number;
	requiredCount: number;
	status: SetupDiagnosticsStatus;
	successCount: number;
	warningCount: number;
}

export interface PiExecutableSelectionResult {
	canceled: boolean;
	error?: string;
	selectedPath?: string;
}

export type RegisterLocalRepositoryDiagnosticSeverity =
	| 'error'
	| 'info'
	| 'warning';

export interface RegisterLocalRepositoryDiagnostic {
	code: string;
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

export interface InitialShellSnapshot {
	capturedAt: string;
	health: HealthSnapshot | null;
	navigation: RepositoryWorkspaceNavigationSnapshot | null;
}

export type GithubRepositoryListStatus = 'failure' | 'success';

export interface GithubRepositoryListResult {
	entries: GithubRepositoryEntry[];
	error?: string;
	generatedAt: string;
	status: GithubRepositoryListStatus;
}

export type QuickStartProjectDiagnosticCode =
	| 'destination-exists'
	| 'destination-not-writable'
	| 'destination-path-relative'
	| 'destination-required'
	| 'git-init-failed'
	| 'git-not-installed'
	| 'mkdir-failed'
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

export interface EnsembleApi {
	confirmRootDirectoryChange: (
		request: RootDirectoryChangeRequest,
	) => Promise<RootDirectoryChangeApplyResult>;
	applyRepositoryConfigMigration: (
		request: RepositoryConfigMigrationRequest,
	) => Promise<RepositoryConfigMigrationResult>;
	createWorkspace: (
		request: CreateWorkspaceRequest,
	) => Promise<CreateWorkspaceResult>;
	ensureWindowWidth: (minimumWidth: number) => Promise<void>;
	environmentVariables: () => Promise<EnvironmentVariablesSnapshot>;
	githubRepositoryList: () => Promise<GithubRepositoryListResult>;
	health: () => Promise<HealthSnapshot>;
	onCloneGithubRepositoryProgress: (
		listener: (event: CloneGithubRepositoryProgressEvent) => void,
	) => () => void;
	prepareCloneGithubRepository: (
		request: CloneGithubRepositoryRequest,
	) => Promise<CloneGithubRepositoryPrepareResult>;
	previewRepositoryConfigMigration: (
		request: RepositoryConfigMigrationRequest,
	) => Promise<RepositoryConfigMigrationPreview>;
	quickStartProject: (
		request: QuickStartProjectRequest,
	) => Promise<QuickStartProjectResult>;
	repositoryConfig: (
		request: RepositoryConfigRequest,
	) => Promise<RepositoryConfigSnapshot>;
	registerLocalRepository: (
		request: RegisterLocalRepositoryRequest,
	) => Promise<RegisterLocalRepositoryResult>;
	repositoryWorkspaceNavigation: () => Promise<RepositoryWorkspaceNavigationSnapshot>;
	rootDirectory: () => Promise<RootDirectorySnapshot>;
	resolveSettings: (
		request?: SettingsResolutionRequest,
	) => Promise<SettingsResolutionSnapshot>;
	selectCloneDestination: () => Promise<CloneDestinationSelectionResult>;
	selectLocalRepository: () => Promise<LocalRepositorySelectionResult>;
	selectPiExecutable: () => Promise<PiExecutableSelectionResult>;
	selectRootDirectory: () => Promise<RootDirectorySelectionResult>;
	setupDiagnostics: () => Promise<SetupDiagnosticsSnapshot>;
	startCloneGithubRepository: (
		request: CloneGithubRepositoryStartRequest,
	) => Promise<CloneGithubRepositoryStartResult>;
}
