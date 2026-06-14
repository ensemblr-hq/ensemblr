import type { RepositoryConfigMigrationPreview, RepositoryConfigMigrationRequest, RepositoryConfigMigrationResult, RepositoryConfigSnapshot } from '../../shared/ipc/contracts/repository-config';
import { loadRepositoryConfig } from './repository-config.ts';
import {
	applyRepositoryConfigMigration,
	normalizeRepositoryConfigRequest,
	previewRepositoryConfigMigration,
} from './repository-config-migration.ts';

/**
 * Backward-compat alias — the implementation moved to the storage repository
 * layer where the SQL lives. Existing config consumers (IPC handlers, tests)
 * keep importing the same symbol from `@/main/config`.
 */
export {
	type IsTrackedRepositoryPathOptions as RepositoryConfigPathAuthorizationOptions,
	isTrackedRepositoryPath as isRepositoryConfigPathAllowed,
} from '../storage/repositories/repository-path-repository.ts';
export type {
	ConfigDiagnostic,
	ConfigStatusSnapshot,
	EnsembleConfig,
	EnsembleConfigLoadResult,
	EnsembleConfigService,
	LoadEnsembleConfigOptions,
} from './config-loader.ts';
export {
	createEnsembleConfigService,
	ENSEMBLE_CONFIG_SCHEMA,
	ENSEMBLE_CONFIG_SCHEMA_VERSION,
	loadEnsembleConfig,
	resolveEnsembleConfigPath,
} from './config-loader.ts';
export type {
	EnsembleConfigResolutionService,
	ResolveSettingsOptions,
} from './config-resolution.ts';
export {
	createEnsembleConfigResolutionService,
	normalizeSettingsResolutionRequest,
	resolveSettings,
} from './config-resolution.ts';
export type {
	LoadedRepositoryConfig,
	LoadRepositoryConfigOptions,
} from './repository-config.ts';
export { loadRepositoryConfig } from './repository-config.ts';
export {
	applyRepositoryConfigMigration,
	normalizeRepositoryConfigRequest,
	previewRepositoryConfigMigration,
} from './repository-config-migration.ts';

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
