import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type { UpdateRepositorySettingsResult } from '../../../shared/ipc/contracts/repository-settings';
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
		(_event, request: unknown): UpdateRepositorySettingsResult => {
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
		},
	);
}
