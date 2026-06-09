import { app, BrowserWindow } from 'electron';
import started from 'electron-squirrel-startup';
import { IPC_CHANNELS, type PiSessionEventBroadcast } from '../shared/ipc';

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
import { createPiExecutableService, createPiReadinessService } from './pi-runtime';
import { createCliRpcPiAgentAdapter, createPiAgentClient } from './pi-agent';
import { createPiSessionService } from './pi-agent/pi-session-service';
import { createSessionSummaryWriter } from './pi-agent/session-summary-writer';
import {
	createArchiveLifecycleService,
	createArchiveRepositoryService,
	createArchiveWorkspaceService,
	createDeleteArchivedWorkspaceService,
	createDeleteRepositoryService,
	createDeleteWorkspaceService,
	createGithubCloneService,
	createGithubRepositoryListService,
	createListArchivedWorkspacesService,
	createLocalRepositoryRegistrationService,
	createQuickStartProjectService,
	createRenameWorkspaceService,
	createSharedRootAdoptionService,
	createUnarchiveWorkspaceService,
	createWorkspaceService,
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
const piAgentAdapter = createCliRpcPiAgentAdapter();
const piAgentClient = createPiAgentClient({ adapter: piAgentAdapter });
const summaryPiAgentAdapter = createCliRpcPiAgentAdapter();
const summaryPiAgentClient = createPiAgentClient({
	adapter: summaryPiAgentAdapter,
});
const sessionSummaryWriter = createSessionSummaryWriter({
	piAgentClient: summaryPiAgentClient,
	resolveExecutable: async () => {
		const snapshot = await piExecutableService.getSnapshot();
		if (snapshot.status === 'error' || !snapshot.command) {
			return null;
		}
		return snapshot;
	},
});
const piSessionService = createPiSessionService({
	databaseService,
	eventSink: ({ event, sessionId, workspaceId }) => {
		const payload: PiSessionEventBroadcast = {
			event: {
				branchId: event.branchId,
				createdAt: event.createdAt,
				eventType: event.eventType,
				id: event.id,
				ordinal: event.ordinal,
				payload: event.payload,
				stream: event.stream,
				turnId: event.turnId,
			},
			sessionId,
			workspaceId,
		};
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) {
				window.webContents.send(IPC_CHANNELS.piSessionEvent, payload);
			}
		}
	},
	piAgentClient,
});
const localRepositoryRegistrationService =
	createLocalRepositoryRegistrationService({
		databaseService,
	});
const githubCloneService = createGithubCloneService({
	databaseService,
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
const createWorkspaceServiceInstance = createWorkspaceService({
	databaseService,
	localCommandService,
	rootDirectoryService,
});
const sharedRootAdoptionService = createSharedRootAdoptionService({
	databaseService,
	rootDirectoryService,
});
const renameWorkspaceService = createRenameWorkspaceService({
	databaseService,
	localCommandService,
});
const archiveLifecycleService = createArchiveLifecycleService();
const archiveWorkspaceService = createArchiveWorkspaceService({
	archiveLifecycleService,
	databaseService,
	localCommandService,
	rootDirectoryService,
});
const archiveRepositoryService = createArchiveRepositoryService({
	archiveLifecycleService,
	archiveWorkspaceService,
	databaseService,
});
const deleteWorkspaceService = createDeleteWorkspaceService({
	databaseService,
	localCommandService,
});
const deleteRepositoryService = createDeleteRepositoryService({
	databaseService,
	localCommandService,
	rootDirectoryService,
});
const unarchiveWorkspaceService = createUnarchiveWorkspaceService({
	archiveLifecycleService,
	databaseService,
	localCommandService,
});
const deleteArchivedWorkspaceService = createDeleteArchivedWorkspaceService({
	databaseService,
	localCommandService,
});
const listArchivedWorkspacesService = createListArchivedWorkspacesService({
	databaseService,
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
	void sharedRootAdoptionService.reconcile();
	installApplicationMenu();
	registerIpcHandlers({
		archiveRepositoryService,
		archiveWorkspaceService,
		configService,
		createWorkspaceService: createWorkspaceServiceInstance,
		databaseService,
		deleteArchivedWorkspaceService,
		deleteRepositoryService,
		deleteWorkspaceService,
		environmentVariablesService,
		githubCloneService,
		githubRepositoryListService,
		listArchivedWorkspacesService,
		localCommandService,
		localRepositoryRegistrationService,
		piExecutableService,
		piSessionService,
		quickStartProjectService,
		renameWorkspaceService,
		repositoryConfigService,
		rootDirectoryService,
		sessionSummaryWriter,
		setupDiagnosticsService,
		settingsResolutionService,
		sharedRootAdoptionService,
		unarchiveWorkspaceService,
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
