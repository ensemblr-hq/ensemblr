import { app, ipcMain } from 'electron';

import { type HealthSnapshot, IPC_CHANNELS } from '../shared/ipc';
import type { PiductorDatabaseService } from './storage/database';

interface RegisterIpcHandlersOptions {
	databaseService: PiductorDatabaseService;
}

export function registerIpcHandlers({
	databaseService,
}: RegisterIpcHandlersOptions): void {
	ipcMain.handle(IPC_CHANNELS.health, (): HealthSnapshot => {
		return {
			appName: app.getName(),
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
	});
}
