import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type { RepositoryConfigSnapshot } from '../../../shared/ipc/contracts/repository-config';
import type { RepositoryConfigService } from '../../config';
import { isRepositoryConfigPathAllowed } from '../../config';
import type { EnsemblrDatabaseService } from '../../storage';
import { parseRepositoryConfigRequest } from '../request-schemas.ts';

/**
 * Registers the IPC handler for repository config inspection.
 * @param options - Required services.
 */
export function registerRepositoryConfigHandlers({
	databaseService,
	repositoryConfigService,
}: {
	databaseService: EnsemblrDatabaseService;
	repositoryConfigService: RepositoryConfigService;
}): void {
	ipcMain.handle(
		IPC_CHANNELS.repositoryConfig,
		(_event, request: unknown): RepositoryConfigSnapshot => {
			const normalizedRequest = parseRepositoryConfigRequest(request);

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

	/** Wraps {@link isRepositoryConfigPathAllowed} with the current database connection. */
	function isAllowedRepositoryConfigPath(repositoryPath: string): boolean {
		return isRepositoryConfigPathAllowed({
			database: databaseService.getConnection()?.database ?? null,
			repositoryPath,
		});
	}
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
