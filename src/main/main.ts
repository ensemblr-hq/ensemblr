import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import started from 'electron-squirrel-startup';

import { createLocalCommandService } from './commands/local-command';
import { createPiductorConfigService } from './config/config-loader';
import { createPiductorConfigResolutionService } from './config/config-resolution';
import { registerIpcHandlers } from './ipc';
import { installApplicationMenu } from './menu';
import { createPiductorRootDirectoryService } from './root/root-directory';
import { createSetupDiagnosticsService } from './setup/setup-diagnostics';
import { createPiductorDatabaseService } from './storage/database';

if (started) {
	app.quit();
}

const macosChromeOptions =
	process.platform === 'darwin'
		? {
				titleBarStyle: 'hiddenInset' as const,
				trafficLightPosition: { x: 14, y: 14 },
			}
		: {};

function createMainWindow(): BrowserWindow {
	const mainWindow = new BrowserWindow({
		...macosChromeOptions,
		backgroundColor: '#0b0808',
		height: 820,
		minHeight: 640,
		minWidth: 960,
		show: false,
		title: 'Piductor',
		width: 1280,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			preload: path.join(__dirname, '../preload/preload.js'),
		},
	});

	mainWindow.once('ready-to-show', () => {
		mainWindow.show();
	});

	if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
		void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
	} else {
		void mainWindow.loadFile(
			path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
		);
	}

	return mainWindow;
}

app.setName('Piductor');

const configService = createPiductorConfigService();
const databaseService = createPiductorDatabaseService();
const localCommandService = createLocalCommandService();
const settingsResolutionService = createPiductorConfigResolutionService({
	configService,
	databaseService,
});
const rootDirectoryService = createPiductorRootDirectoryService({
	databaseService,
	settingsResolutionService,
});
const setupDiagnosticsService = createSetupDiagnosticsService({
	configService,
	databaseService,
	localCommandService,
	rootDirectoryService,
});

app.whenReady().then(() => {
	configService.load();
	databaseService.open();
	rootDirectoryService.ensure();
	installApplicationMenu();
	registerIpcHandlers({
		configService,
		databaseService,
		rootDirectoryService,
		setupDiagnosticsService,
		settingsResolutionService,
	});
	createMainWindow();
});

app.on('before-quit', () => {
	databaseService.close();
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});

app.on('activate', () => {
	if (BrowserWindow.getAllWindows().length === 0) {
		createMainWindow();
	}
});
