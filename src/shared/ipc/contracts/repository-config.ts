import type { ConfigDiagnostic } from './health';
import type { SettingsResolutionSource } from './settings-resolution';

export type RepositoryConfigSourceStatus = 'invalid' | 'loaded' | 'missing';

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

/** Per-repository config-resolution IPC surface (read snapshot). */
export interface RepositoryConfigApi {
	repositoryConfig: (
		request: RepositoryConfigRequest,
	) => Promise<RepositoryConfigSnapshot>;
}
