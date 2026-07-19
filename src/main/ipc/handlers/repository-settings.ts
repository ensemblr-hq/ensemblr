import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	OpenRepositoryConfigFileRequest,
	OpenRepositoryConfigFileResult,
	UpdateRepositorySettingsResult,
} from '../../../shared/ipc/contracts/repository-settings';
import { openInEditor } from '../../config/open-in-editor.ts';
import { ensureRepositoryConfigFile } from '../../config/repository-config-file.ts';
import { upsertRepositorySettings } from '../../environment/repository-settings.ts';
import type { EnsemblrDatabaseService } from '../../storage';
import { parseUpdateRepositorySettingsRequest } from '../request-schemas.ts';

/**
 * Registers the IPC handler that persists personal repository settings (Git and
 * Misc screens) to repository-scoped SQLite rows the settings resolver reads.
 * @param options - Required services.
 */
export function registerRepositorySettingsHandlers({
	databaseService,
}: {
	databaseService: EnsemblrDatabaseService;
}): void {
	ipcMain.handle(
		IPC_CHANNELS.updateRepositorySettings,
		(_event, request: unknown): UpdateRepositorySettingsResult =>
			persistRepositorySettings(databaseService, request),
	);

	ipcMain.handle(
		IPC_CHANNELS.openRepositoryConfigFile,
		(
			_event,
			request: OpenRepositoryConfigFileRequest,
		): Promise<OpenRepositoryConfigFileResult> => openRepositoryConfig(request),
	);
}

/**
 * Validates and persists a repository-settings patch to SQLite, returning
 * `{ ok: false }` for malformed input, a closed database, or a write error.
 * @param databaseService - Database service providing the active connection.
 * @param request - Raw IPC payload.
 * @returns The write result.
 */
function persistRepositorySettings(
	databaseService: EnsemblrDatabaseService,
	request: unknown,
): UpdateRepositorySettingsResult {
	const parsed = parseUpdateRepositorySettingsRequest(request);
	const database = databaseService.getConnection()?.database;

	if (!parsed || !database) {
		return { ok: false };
	}

	try {
		upsertRepositorySettings({
			database,
			repositoryId: parsed.repositoryId,
			settings: parsed.settings,
		});
		return { ok: true };
	} catch (error) {
		console.error(
			'[repository-settings] failed to persist repository settings',
			error,
		);
		return { ok: false };
	}
}

/**
 * Ensures the repo's committed config exists and opens it in the user's editor.
 * @param request - Request carrying the repository path.
 * @returns The open result, with `error` set when it could not be opened.
 */
async function openRepositoryConfig(
	request: OpenRepositoryConfigFileRequest,
): Promise<OpenRepositoryConfigFileResult> {
	const repositoryPath =
		typeof request?.repositoryPath === 'string'
			? request.repositoryPath.trim()
			: '';

	if (!repositoryPath) {
		return { error: 'A repository path is required to open its config.' };
	}

	try {
		return await openInEditor(ensureRepositoryConfigFile(repositoryPath));
	} catch (error) {
		return {
			error:
				error instanceof Error
					? error.message
					: 'Failed to open the repository config file.',
		};
	}
}
