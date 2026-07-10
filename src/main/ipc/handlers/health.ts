import { app, ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type { HealthSnapshot } from '../../../shared/ipc/contracts/health';
import type { EnsemblrConfigService } from '../../config';
import type { EnsemblrDatabaseService } from '../../storage';

/** Service dependencies used by the health-snapshot IPC handler. */
export interface HealthHandlersOptions {
	configService: EnsemblrConfigService;
	databaseService: EnsemblrDatabaseService;
}

/**
 * Registers the async health-snapshot IPC handler. The synchronous
 * initial-shell snapshot lives in `handlers/shell-snapshot.ts` so this file
 * stays scoped to health alone.
 * @param options - Required services.
 */
export function registerHealthHandlers({
	configService,
	databaseService,
}: HealthHandlersOptions): void {
	ipcMain.handle(IPC_CHANNELS.health, (): HealthSnapshot => {
		return buildHealthSnapshot(configService, databaseService);
	});
}

/** Single source of truth for the health-snapshot shape. */
export function buildHealthSnapshot(
	configService: EnsemblrConfigService,
	databaseService: EnsemblrDatabaseService,
): HealthSnapshot {
	return {
		appName: app.getName(),
		config: configService.getSnapshot(),
		database: databaseService.getHealth(),
		platform: process.platform,
		status: 'ok',
		timestamp: new Date().toISOString(),
		versions: {
			chrome: process.versions.chrome,
			electron: process.versions.electron,
			node: process.versions.node,
		},
	};
}
