export const IPC_CHANNELS = {
	ensureWindowWidth: 'ensemble:ensure-window-width',
	health: 'ensemble:health',
	rootDirectory: 'ensemble:root-directory',
	setupDiagnostics: 'ensemble:setup-diagnostics',
	settingsResolution: 'ensemble:settings-resolution',
} as const;

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
	| 'config-default'
	| 'managed-config'
	| 'ensemble-config'
	| 'sqlite';
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
}

export interface SettingsResolutionRequest {
	repository?: RepositorySettingsResolutionRequest;
}

export interface SettingsResolutionSnapshot {
	app: SettingsResolutionGroupSnapshot;
	repository?: SettingsResolutionGroupSnapshot;
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

export type SetupDiagnosticsStatus = 'blocked' | 'checking' | 'ready';
export type SetupCheckGroupId = 'core' | 'github' | 'linear' | 'pi' | 'storage';
export type SetupCheckId =
	| 'config'
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

export interface EnsembleApi {
	ensureWindowWidth: (minimumWidth: number) => Promise<void>;
	health: () => Promise<HealthSnapshot>;
	rootDirectory: () => Promise<RootDirectorySnapshot>;
	resolveSettings: (
		request?: SettingsResolutionRequest,
	) => Promise<SettingsResolutionSnapshot>;
	setupDiagnostics: () => Promise<SetupDiagnosticsSnapshot>;
}
