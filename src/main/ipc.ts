import { app, ipcMain } from 'electron';

import { type HealthSnapshot, IPC_CHANNELS } from '../shared/ipc';

export function registerIpcHandlers(): void {
	ipcMain.handle(IPC_CHANNELS.health, (): HealthSnapshot => {
		return {
			appName: app.getName(),
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
