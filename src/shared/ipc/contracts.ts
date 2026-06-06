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

export interface EnsembleApi {
	confirmRootDirectoryChange: (
		request: RootDirectoryChangeRequest,
	) => Promise<RootDirectoryChangeApplyResult>;
	applyRepositoryConfigMigration: (
		request: RepositoryConfigMigrationRequest,
	) => Promise<RepositoryConfigMigrationResult>;
	ensureWindowWidth: (minimumWidth: number) => Promise<void>;
	environmentVariables: () => Promise<EnvironmentVariablesSnapshot>;
	health: () => Promise<HealthSnapshot>;
	previewRepositoryConfigMigration: (
		request: RepositoryConfigMigrationRequest,
	) => Promise<RepositoryConfigMigrationPreview>;
	repositoryConfig: (
		request: RepositoryConfigRequest,
	) => Promise<RepositoryConfigSnapshot>;
	rootDirectory: () => Promise<RootDirectorySnapshot>;
	resolveSettings: (
		request?: SettingsResolutionRequest,
	) => Promise<SettingsResolutionSnapshot>;
	selectPiExecutable: () => Promise<PiExecutableSelectionResult>;
	selectRootDirectory: () => Promise<RootDirectorySelectionResult>;
	setupDiagnostics: () => Promise<SetupDiagnosticsSnapshot>;
}
