import type { DatabaseSync } from 'node:sqlite';

import type { RepositoryConfigSnapshot } from '../../shared/ipc/contracts/repository-config';
import {
	loadRepositoryConfig,
	normalizeRepositoryConfigRequest,
} from './repository-config.ts';
import { isWritableWorkspaceTarget } from './settings-publication-files.ts';
import { resolveWorkspaceSettingsTarget } from './workspace-settings-target.ts';

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
	EnsemblrConfig,
	EnsemblrConfigLoadResult,
	EnsemblrConfigService,
	LoadEnsemblrConfigOptions,
} from './config-loader.ts';
export {
	createEnsemblrConfigService,
	ENSEMBLR_CONFIG_SCHEMA,
	ENSEMBLR_CONFIG_SCHEMA_VERSION,
	loadEnsemblrConfig,
	resolveEnsemblrConfigPath,
} from './config-loader.ts';
export type {
	EnsemblrConfigResolutionService,
	ResolveSettingsOptions,
} from './config-resolution.ts';
export {
	createEnsemblrConfigResolutionService,
	normalizeSettingsResolutionRequest,
	resolveSettings,
} from './config-resolution.ts';
export { isPlainRecord } from './json-utils.ts';
export type {
	LoadedRepositoryConfig,
	LoadRepositoryConfigOptions,
} from './repository-config.ts';
export {
	loadRepositoryConfig,
	normalizeRepositoryConfigRequest,
} from './repository-config.ts';
export type {
	PendingRepositoryScripts,
	ReadPendingRepositoryScriptsInput,
} from './repository-scripts-migration.ts';
export {
	dropRetainedRepositoryScripts,
	readPendingRepositoryScripts,
} from './repository-scripts-migration.ts';
export type {
	WriteRepositoryScriptsInput,
	WriteRepositoryScriptsResult,
} from './repository-scripts-writer.ts';
export { writeRepositoryScripts } from './repository-scripts-writer.ts';
export type { WriteRepositorySettingsResult } from './repository-settings-writer.ts';
export {
	hasRepositorySettingsFile,
	readRepositorySettings,
	rewriteRepositorySettings,
} from './repository-settings-writer.ts';
export { isWritableWorkspaceTarget } from './settings-publication-files.ts';
export type {
	CreateSettingsPublicationServiceOptions,
	SettingsPublicationService,
} from './settings-publication-service.ts';
export { createSettingsPublicationService } from './settings-publication-service.ts';
export type { WorkspaceSettingsTarget } from './workspace-settings-target.ts';
export { resolveWorkspaceSettingsTarget } from './workspace-settings-target.ts';

/**
 * Resolves the live workspace checkout an IPC settings write may target. The
 * stored path is only a record of where a worktree was, so it is re-validated
 * against Git before anything is written into it — a workspace that has been
 * moved, deleted, or re-pointed at another repository resolves to nothing
 * rather than to a stale directory. Root clones are never returned (ADR 0070).
 * @param database - Active database connection.
 * @param repositoryId - Repository the settings screen belongs to.
 * @param workspaceId - Live workspace the user selected as the write target.
 * @returns The workspace checkout path, or null when there is no writable one.
 */
export function resolveWritableWorkspaceCheckout({
	database,
	repositoryId,
	workspaceId,
}: {
	database: DatabaseSync;
	repositoryId: string;
	workspaceId: string;
}): string | null {
	const target = resolveWorkspaceSettingsTarget({
		database,
		repositoryId,
		workspaceId,
	});

	return target && isWritableWorkspaceTarget(target)
		? target.workspacePath
		: null;
}

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
