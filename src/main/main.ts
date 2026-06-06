import { app, BrowserWindow } from 'electron';
import started from 'electron-squirrel-startup';

import { createMainWindow } from './app';
import { createLocalCommandService } from './commands';
import {
	createEnsembleConfigResolutionService,
	createEnsembleConfigService,
} from './config';
import { createEnvironmentVariablesService } from './environment';
import { registerIpcHandlers } from './ipc';
import { installApplicationMenu } from './menu';
import { createPiExecutableService, createPiReadinessService } from './pi';
import {
	createEnsembleRootDirectoryService,
	reconcileRootDirectory,
} from './root';
import { createMacosKeychainSecretStore } from './secrets';
import { createSetupDiagnosticsService } from './setup';
import { createEnsembleDatabaseService } from './storage';

if (started) {
	app.quit();
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
	reconcileRootDirectory,
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
