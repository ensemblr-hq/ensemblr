import type { ConfigDiagnostic } from './config';
import type { SettingsResolutionSource } from './settings-resolution';

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
