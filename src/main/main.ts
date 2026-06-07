import { app, BrowserWindow } from 'electron';
import started from 'electron-squirrel-startup';

import { createMainWindow, createMainWindowStateStore } from './app';
import { createLocalCommandService } from './commands';
import {
	createEnsembleConfigResolutionService,
	createEnsembleConfigService,
	createRepositoryConfigService,
} from './config';
import { createEnvironmentVariablesService } from './environment';
import { registerIpcHandlers } from './ipc';
import { installApplicationMenu } from './menu';
import { createPiExecutableService, createPiReadinessService } from './pi';
import {
	createGithubCloneService,
	createGithubRepositoryListService,
	createLocalRepositoryRegistrationService,
	createQuickStartProjectService,
} from './repository';
import {
	createEnsembleRootDirectoryService,
	reconcileRootDirectory,
} from './root';
import { createMacosKeychainSecretStore } from './secrets';
import { createSetupDiagnosticsService } from './setup';
import { createEnsembleDatabaseService } from './storage';

// Quit early on Windows when invoked by the Squirrel installer.
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
const repositoryConfigService = createRepositoryConfigService();
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
const localRepositoryRegistrationService =
	createLocalRepositoryRegistrationService({
		databaseService,
	});
const githubCloneService = createGithubCloneService({
	registrationService: localRepositoryRegistrationService,
	rootDirectoryService,
});
const githubRepositoryListService = createGithubRepositoryListService({
	localCommandService,
});
const quickStartProjectService = createQuickStartProjectService({
	localCommandService,
	registrationService: localRepositoryRegistrationService,
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
const mainWindowStateStore = createMainWindowStateStore({
	databaseService,
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
		githubCloneService,
		githubRepositoryListService,
		localRepositoryRegistrationService,
		piExecutableService,
		quickStartProjectService,
		repositoryConfigService,
		rootDirectoryService,
		setupDiagnosticsService,
		settingsResolutionService,
	});
	createMainWindow({ windowStateStore: mainWindowStateStore });
});

app.on('will-quit', () => {
	databaseService.close();
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});

app.on('activate', () => {
	if (BrowserWindow.getAllWindows().length === 0) {
		createMainWindow({ windowStateStore: mainWindowStateStore });
	}
});
