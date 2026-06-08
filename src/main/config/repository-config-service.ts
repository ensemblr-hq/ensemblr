import type {
	RepositoryConfigMigrationPreview,
	RepositoryConfigMigrationRequest,
	RepositoryConfigMigrationResult,
	RepositoryConfigSnapshot,
} from '../../shared/ipc';
import { loadRepositoryConfig } from './repository-config.ts';
import {
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
