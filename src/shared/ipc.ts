export const IPC_CHANNELS = {
	health: 'piductor:health',
	rootDirectory: 'piductor:root-directory',
	settingsResolution: 'piductor:settings-resolution',
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
	| 'piductor-config'
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
	piductorConfig?: Record<string, unknown>;
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

export interface PiductorApi {
	health: () => Promise<HealthSnapshot>;
	rootDirectory: () => Promise<RootDirectorySnapshot>;
	resolveSettings: (
		request?: SettingsResolutionRequest,
	) => Promise<SettingsResolutionSnapshot>;
}
