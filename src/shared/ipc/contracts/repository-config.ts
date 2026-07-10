import type { ConfigDiagnostic } from './health';
import type { SettingsResolutionSource } from './settings-resolution';

/** Load status of a single repository config source file. */
export type RepositoryConfigSourceStatus = 'invalid' | 'loaded' | 'missing';

/** Snapshot of one resolved repository config source and its parsed settings. */
export interface RepositoryConfigSourceSnapshot {
	displayPath: string;
	path: string;
	settings: Record<string, unknown>;
	source: SettingsResolutionSource;
	status: RepositoryConfigSourceStatus;
}

/** Snapshot of a repository's resolved config across all of its sources. */
export interface RepositoryConfigSnapshot {
	diagnostics: ConfigDiagnostic[];
	loadedAt: string;
	repositoryPath: string;
	sources: RepositoryConfigSourceSnapshot[];
}

/** Request to read the resolved config snapshot for a repository. */
export interface RepositoryConfigRequest {
	repositoryPath: string;
}

/** Per-repository config-resolution IPC surface (read snapshot). */
export interface RepositoryConfigApi {
	repositoryConfig: (
		request: RepositoryConfigRequest,
	) => Promise<RepositoryConfigSnapshot>;
}
