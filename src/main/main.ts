import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import started from 'electron-squirrel-startup';

import { createLocalCommandService } from './commands/local-command';
import { createEnsembleConfigService } from './config/config-loader';
import { createEnsembleConfigResolutionService } from './config/config-resolution';
import { createEnvironmentVariablesService } from './environment/environment-variables';
import { registerIpcHandlers } from './ipc';
import { installApplicationMenu } from './menu';
import { createPiExecutableService } from './pi/pi-executable';
import { createPiReadinessService } from './pi/pi-readiness';
import { createEnsembleRootDirectoryService } from './root/root-directory';
import { createMacosKeychainSecretStore } from './secrets/secret-store';
import { createSetupDiagnosticsService } from './setup/setup-diagnostics';
import { createEnsembleDatabaseService } from './storage/database';

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
		title: 'Ensemble',
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

app.setName('Ensemble');

const configService = createEnsembleConfigService();
const databaseService = createEnsembleDatabaseService();
const localCommandService = createLocalCommandService();
const environmentVariablesService = createEnvironmentVariablesService({
	configService,
	databaseService,
	secretStoreFactory: (database) =>
		process.platform === 'darwin'
			? createMacosKeychainSecretStore({ database })
			: null,
});
const settingsResolutionService = createEnsembleConfigResolutionService({
	configService,
	databaseService,
});
const rootDirectoryService = createEnsembleRootDirectoryService({
	databaseService,
	settingsResolutionService,
});
const piExecutableService = createPiExecutableService({
	databaseService,
	localCommandService,
	settingsResolutionService,
});
const piReadinessService = createPiReadinessService({
	localCommandService,
	piExecutableService,
	rootDirectoryService,
});
const setupDiagnosticsService = createSetupDiagnosticsService({
	configService,
	databaseService,
	environmentVariablesService,
	localCommandService,
	piExecutableService,
	piReadinessService,
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
		environmentVariablesService,
		piExecutableService,
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
