/** Scope a setting is resolved at: app-wide or a specific repository. */
export type SettingsResolutionScope = 'app' | 'repository';
/** Provenance source that supplied a resolved settings value. */
export type SettingsResolutionSource =
	| 'built-in-default'
	| 'config-default'
	| 'managed-config'
	| 'ensemblr-config'
	| 'sqlite'
	| 'user-default'
	| 'worktreeinclude';
/** Outcome of a candidate value considered during settings resolution. */
export type SettingsResolutionCandidateStatus =
	| 'ignored'
	| 'invalid'
	| 'selected';

/** One candidate value considered when resolving a setting, with its source and status. */
export interface SettingResolutionCandidateSnapshot {
	reason: string;
	source: SettingsResolutionSource;
	status: SettingsResolutionCandidateStatus;
}

/** A resolved setting's final value alongside the candidates that were considered. */
export interface ResolvedSettingSnapshot {
	candidates: SettingResolutionCandidateSnapshot[];
	key: string;
	locked: boolean;
	source: SettingsResolutionSource;
	value: unknown;
}

/** Diagnostic recorded while resolving a setting, such as an ignored or invalid candidate. */
export interface SettingsResolutionDiagnostic {
	key: string;
	message: string;
	scope: SettingsResolutionScope;
	source: SettingsResolutionSource;
	status: SettingsResolutionCandidateStatus;
}

/** Resolved settings plus diagnostics for one scope (app or repository). */
export interface SettingsResolutionGroupSnapshot {
	diagnostics: SettingsResolutionDiagnostic[];
	settings: ResolvedSettingSnapshot[];
}

/** Request to resolve effective settings for a specific repository. */
export interface RepositorySettingsResolutionRequest {
	ensemblrConfig?: Record<string, unknown>;
	repositoryId: string;
	repositoryPath?: string;
}

/** Request to resolve effective settings, optionally including a repository scope. */
export interface SettingsResolutionRequest {
	repository?: RepositorySettingsResolutionRequest;
}

/** Resolved app settings and, when requested, repository settings. */
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
