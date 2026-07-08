import type { RepositoryConfigSnapshot } from '../../shared/ipc/contracts/repository-config';
import {
	loadRepositoryConfig,
	normalizeRepositoryConfigRequest,
} from './repository-config.ts';

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
	AppSettingsService,
	CreateAppSettingsServiceOptions,
} from './app-settings-service.ts';
export { createAppSettingsService } from './app-settings-service.ts';
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
export {
	loadRepositoryConfig,
	normalizeRepositoryConfigRequest,
} from './repository-config.ts';

/** Service exposed to IPC handlers for inspecting per-repository config. */
export interface RepositoryConfigService {
	load: (request: unknown) => RepositoryConfigSnapshot;
}

/**
 * Builds the {@link RepositoryConfigService} used by IPC handlers to load
 * per-repository configuration files.
 */
export function createRepositoryConfigService(): RepositoryConfigService {
	return {
		load: (request) =>
			loadRepositoryConfig(normalizeRepositoryConfigRequest(request)).snapshot,
	};
}
