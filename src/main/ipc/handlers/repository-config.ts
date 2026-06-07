import { ipcMain } from 'electron';

import {
	IPC_CHANNELS,
	type RepositoryConfigMigrationPreview,
	type RepositoryConfigMigrationRequest,
	type RepositoryConfigMigrationResult,
	type RepositoryConfigRequest,
	type RepositoryConfigSnapshot,
} from '../../../shared/ipc';
import type { RepositoryConfigService } from '../../config';
import { isRepositoryConfigPathAllowed } from '../../config';
import type { EnsembleDatabaseService } from '../../storage';

/** Service dependencies used by the repository-config IPC handlers. */
export interface RepositoryConfigHandlersOptions {
	databaseService: EnsembleDatabaseService;
	repositoryConfigService: RepositoryConfigService;
}

/**
 * Registers IPC handlers for repository config inspection and migration.
 * @param options - Required services.
 */
export function registerRepositoryConfigHandlers({
	databaseService,
	repositoryConfigService,
}: RepositoryConfigHandlersOptions): void {
	ipcMain.handle(
		IPC_CHANNELS.repositoryConfig,
		(_event, request: unknown): RepositoryConfigSnapshot => {
			const normalizedRequest = normalizeRepositoryConfigRequest(request);

			if (
				normalizedRequest.repositoryPath &&
				!isAllowedRepositoryConfigPath(normalizedRequest.repositoryPath)
			) {
				return createDeniedRepositoryConfigSnapshot(
					normalizedRequest.repositoryPath,
				);
			}

			return repositoryConfigService.load(normalizedRequest);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.previewRepositoryConfigMigration,
		(_event, request: unknown): RepositoryConfigMigrationPreview => {
			const normalizedRequest =
				normalizeRepositoryConfigMigrationRequest(request);

			if (
				normalizedRequest.repositoryPath &&
				!isAllowedRepositoryConfigPath(normalizedRequest.repositoryPath)
			) {
				return createDeniedRepositoryConfigMigrationPreview(
					normalizedRequest.repositoryPath,
				);
			}

			return repositoryConfigService.previewMigration(normalizedRequest);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.applyRepositoryConfigMigration,
		(_event, request: unknown): RepositoryConfigMigrationResult => {
			const normalizedRequest =
				normalizeRepositoryConfigMigrationRequest(request);

			if (
				normalizedRequest.repositoryPath &&
				!isAllowedRepositoryConfigPath(normalizedRequest.repositoryPath)
			) {
				return {
					...createDeniedRepositoryConfigMigrationPreview(
						normalizedRequest.repositoryPath,
					),
					applied: false,
					error:
						'Repository config migration can only be applied to a known repository or workspace path.',
				};
			}

			return repositoryConfigService.applyMigration(normalizedRequest);
		},
	);

	/** Wraps {@link isRepositoryConfigPathAllowed} with the current database connection. */
	function isAllowedRepositoryConfigPath(repositoryPath: string): boolean {
		return isRepositoryConfigPathAllowed({
			database: databaseService.getConnection()?.database ?? null,
			repositoryPath,
		});
	}
}

/** Coerces an IPC payload into a {@link RepositoryConfigRequest}. */
function normalizeRepositoryConfigRequest(
	request: unknown,
): RepositoryConfigRequest {
	if (
		typeof request !== 'object' ||
		request === null ||
		!('repositoryPath' in request) ||
		typeof request.repositoryPath !== 'string'
	) {
		return { repositoryPath: '' };
	}

	return { repositoryPath: request.repositoryPath.trim() };
}

/** Coerces an IPC payload into a {@link RepositoryConfigMigrationRequest}. */
function normalizeRepositoryConfigMigrationRequest(
	request: unknown,
): RepositoryConfigMigrationRequest {
	if (
		typeof request !== 'object' ||
		request === null ||
		!('repositoryPath' in request) ||
		typeof request.repositoryPath !== 'string'
	) {
		return { repositoryPath: '' };
	}

	return {
		overwrite:
			'overwrite' in request && request.overwrite === true ? true : undefined,
		repositoryPath: request.repositoryPath.trim(),
	};
}

/** Returns a synthetic snapshot used when a path is not authorised. */
function createDeniedRepositoryConfigSnapshot(
	repositoryPath: string,
): RepositoryConfigSnapshot {
	return {
		diagnostics: [
			{
				code: 'repository-config-path-not-allowed',
				message:
					'Repository config can only be loaded for a known repository or workspace path.',
				severity: 'error',
			},
		],
		loadedAt: new Date().toISOString(),
		repositoryPath,
		sources: [],
	};
}

/** Returns a synthetic migration preview used when a path is not authorised. */
function createDeniedRepositoryConfigMigrationPreview(
	repositoryPath: string,
): RepositoryConfigMigrationPreview {
	return {
		canApply: false,
		changes: [],
		diagnostics: [
			{
				code: 'repository-config-path-not-allowed',
				message:
					'Repository config migration can only be applied to a known repository or workspace path.',
				severity: 'error',
			},
		],
		repositoryPath,
		resultingConfig: {},
		sourcePath: null,
		targetExists: false,
		targetPath: '',
	};
}
