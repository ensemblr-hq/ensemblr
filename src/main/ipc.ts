import { app, BrowserWindow, ipcMain } from 'electron';

import {
	type HealthSnapshot,
	IPC_CHANNELS,
	type RootDirectorySnapshot,
	type SettingsResolutionSnapshot,
	type SetupDiagnosticsSnapshot,
} from '../shared/ipc';
import type { EnsembleConfigService } from './config/config-loader';
import type { EnsembleConfigResolutionService } from './config/config-resolution';
import type { EnsembleRootDirectoryService } from './root/root-directory';
import type { SetupDiagnosticsService } from './setup/setup-diagnostics';
import type { EnsembleDatabaseService } from './storage/database';

const MAX_ENSURED_WINDOW_WIDTH = 2400;

interface RegisterIpcHandlersOptions {
	configService: EnsembleConfigService;
	databaseService: EnsembleDatabaseService;
	rootDirectoryService: EnsembleRootDirectoryService;
	setupDiagnosticsService: SetupDiagnosticsService;
	settingsResolutionService: EnsembleConfigResolutionService;
}

export function registerIpcHandlers({
	configService,
	databaseService,
	rootDirectoryService,
	setupDiagnosticsService,
	settingsResolutionService,
}: RegisterIpcHandlersOptions): void {
	ipcMain.handle(
		IPC_CHANNELS.ensureWindowWidth,
		(event, minimumWidth: unknown) => {
			const requestedWidth =
				typeof minimumWidth === 'number' && Number.isFinite(minimumWidth)
					? Math.ceil(minimumWidth)
					: 0;

			if (requestedWidth <= 0) {
				return;
			}

			const window = BrowserWindow.fromWebContents(event.sender);

			if (!window || window.isDestroyed() || window.isFullScreen()) {
				return;
			}

			const targetWidth = Math.min(requestedWidth, MAX_ENSURED_WINDOW_WIDTH);
			const [width, height] = window.getSize();

			if (width < targetWidth) {
				window.setSize(targetWidth, height);
			}
		},
	);

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

	ipcMain.handle(IPC_CHANNELS.rootDirectory, (): RootDirectorySnapshot => {
		return rootDirectoryService.getSnapshot() ?? rootDirectoryService.ensure();
	});

	ipcMain.handle(
		IPC_CHANNELS.setupDiagnostics,
		(): Promise<SetupDiagnosticsSnapshot> => {
			return setupDiagnosticsService.getSnapshot();
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.settingsResolution,
		(_event, request: unknown): SettingsResolutionSnapshot => {
			return settingsResolutionService.resolve(request);
		},
	);
}
