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

/** Settings resolution IPC surface (resolve effective app/repository settings). */
export interface SettingsApi {
	resolveSettings: (
		request?: SettingsResolutionRequest,
	) => Promise<SettingsResolutionSnapshot>;
}
