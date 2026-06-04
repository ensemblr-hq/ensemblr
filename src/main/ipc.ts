import { app, ipcMain } from 'electron';

import {
	type HealthSnapshot,
	IPC_CHANNELS,
	type SettingsResolutionSnapshot,
} from '../shared/ipc';
import type { PiductorConfigService } from './config/config-loader';
import type { PiductorConfigResolutionService } from './config/config-resolution';
import type { PiductorDatabaseService } from './storage/database';

interface RegisterIpcHandlersOptions {
	configService: PiductorConfigService;
	databaseService: PiductorDatabaseService;
	settingsResolutionService: PiductorConfigResolutionService;
}

export function registerIpcHandlers({
	configService,
	databaseService,
	settingsResolutionService,
}: RegisterIpcHandlersOptions): void {
	ipcMain.handle(IPC_CHANNELS.health, (): HealthSnapshot => {
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
	});

	ipcMain.handle(
		IPC_CHANNELS.settingsResolution,
		(_event, request: unknown): SettingsResolutionSnapshot => {
			return settingsResolutionService.resolve(request);
		},
	);
}
