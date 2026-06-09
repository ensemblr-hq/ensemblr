import type {
	RepositoryConfigMigrationPreview,
	RepositoryConfigMigrationRequest,
	RepositoryConfigMigrationResult,
	RepositoryConfigSnapshot,
} from '../../shared/ipc';
import { loadRepositoryConfig } from './repository-config';
import {
	applyRepositoryConfigMigration,
	normalizeRepositoryConfigRequest,
	previewRepositoryConfigMigration,
} from './repository-config-migration';

export type {
	ConfigDiagnostic,
	ConfigStatusSnapshot,
	EnsembleConfig,
	EnsembleConfigLoadResult,
	EnsembleConfigService,
	LoadEnsembleConfigOptions,
} from './config-loader';
export {
	createEnsembleConfigService,
	ENSEMBLE_CONFIG_SCHEMA,
	ENSEMBLE_CONFIG_SCHEMA_VERSION,
	loadEnsembleConfig,
	resolveEnsembleConfigPath,
} from './config-loader';
export type {
	EnsembleConfigResolutionService,
	ResolveSettingsOptions,
} from './config-resolution';
export {
	createEnsembleConfigResolutionService,
	normalizeSettingsResolutionRequest,
	resolveSettings,
} from './config-resolution';
export type {
	LoadedRepositoryConfig,
	LoadRepositoryConfigOptions,
} from './repository-config';
export {
	isRepositoryConfigPathAllowed,
	loadRepositoryConfig,
} from './repository-config';
export {
	applyRepositoryConfigMigration,
	normalizeRepositoryConfigRequest,
	previewRepositoryConfigMigration,
} from './repository-config-migration';

/** Service exposed to IPC handlers for inspecting and migrating repo config. */
export interface RepositoryConfigService {
	applyMigration: (
		request: RepositoryConfigMigrationRequest,
	) => RepositoryConfigMigrationResult;
	load: (request: unknown) => RepositoryConfigSnapshot;
	previewMigration: (
		request: RepositoryConfigMigrationRequest,
	) => RepositoryConfigMigrationPreview;
}

/**
 * Builds the {@link RepositoryConfigService} used by IPC handlers to load and
 * migrate per-repository configuration files.
 */
export function createRepositoryConfigService(): RepositoryConfigService {
	return {
		applyMigration: (request) => applyRepositoryConfigMigration(request),
		load: (request) =>
			loadRepositoryConfig(normalizeRepositoryConfigRequest(request)).snapshot,
		previewMigration: (request) => previewRepositoryConfigMigration(request),
	};
}
