import { app, BrowserWindow, shell } from 'electron';
import started from 'electron-squirrel-startup';
import { IPC_CHANNELS } from '../shared/ipc/channels';
import type {
	PiRawFrameBroadcast,
	PiRawFrameKind,
	PiSessionEventBroadcast,
} from '../shared/ipc/contracts/pi-session';
import type {
	TerminalLifecycleBroadcast,
	TerminalOutputBroadcast,
} from '../shared/ipc/contracts/terminal';

import { createMainWindow } from './app/main-window';
import { createMainWindowStateStore } from './app/window-state';
import { createLocalCommandService } from './commands';
import {
	createEnsembleConfigResolutionService,
	createEnsembleConfigService,
	createRepositoryConfigService,
} from './config';
import {
	createEnvironmentVariablesService,
	createWorkspaceEnvironmentService,
} from './environment';
import { registerIpcHandlers } from './ipc';
import {
	createLinearAuthService,
	createLinearClient,
	createLinearService,
} from './linear';
import { installApplicationMenu } from './menu';
import { createOpenTargetService } from './open-target';
import { createCliRpcPiAgentAdapter, createPiAgentClient } from './pi-agent';
import { createPiSessionService } from './pi-agent/pi-session-service';
import { createSessionSummaryWriter } from './pi-agent/session-summary-writer';
import {
	createPiExecutableService,
	createPiReadinessService,
} from './pi-runtime';
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
	createLocalRepositoryImportService,
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
import {
	createScriptLifecycleService,
	withArchiveScriptBeforeArchive,
	withSetupScriptOnCreate,
} from './scripts';
import { createMacosKeychainSecretStore } from './secrets';
import { createSetupDiagnosticsService } from './setup';
import { createEnsembleDatabaseService } from './storage';
import { createTerminalService } from './terminal';
import { createListWorkspaceFilesService } from './workspace-files';

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
/**
 * Debug-only fan-out for raw Pi RPC frames. Pipes every JSONL line that
 * crosses the boundary (rx + tx) to all renderer windows so the temporary
 * debug panel can inspect them while iterating on conversation UI. Never
 * persisted; subscribers may discard frames at will.
 *
 * `kind` lets the renderer scope traffic to user-facing chat vs. internal
 * Ensemble jobs (chat-title generation, session-summary generation). It is
 * derived from the session label so the same broadcast funnel covers both
 * the main client and the summary client.
 */
const classifyRawFrameKind = (label: string): PiRawFrameKind => {
	if (label === 'ensemble-chat-title') {
		return 'title';
	}
	if (label === 'ensemble-session-summary') {
		return 'summary';
	}
	if (label === 'pi-agent-session') {
		return 'chat';
	}
	return 'unknown';
};
const broadcastRawFrame = (sample: {
	at: string;
	direction: 'rx' | 'tx';
	label: string;
	line: string;
	sessionId: string;
}): void => {
	const payload: PiRawFrameBroadcast = {
		at: sample.at,
		direction: sample.direction,
		kind: classifyRawFrameKind(sample.label),
		label: sample.label,
		line: sample.line,
		sessionId: sample.sessionId,
	};
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) {
			window.webContents.send(IPC_CHANNELS.piRawFrame, payload);
		}
	}
};
const piAgentAdapter = createCliRpcPiAgentAdapter({
	onRawFrame: broadcastRawFrame,
});
const piAgentClient = createPiAgentClient({ adapter: piAgentAdapter });
const summaryPiAgentAdapter = createCliRpcPiAgentAdapter({
	onRawFrame: broadcastRawFrame,
});
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
	sessionSummaryWriter,
});
const localRepositoryRegistrationService =
	createLocalRepositoryRegistrationService({
		databaseService,
	});
const localRepositoryImportService = createLocalRepositoryImportService({
	localCommandService,
	registrationService: localRepositoryRegistrationService,
	rootDirectoryService,
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
const listWorkspaceFilesService = createListWorkspaceFilesService({
	localCommandService,
});
const workspaceEnvironmentService = createWorkspaceEnvironmentService({
	databaseService,
	environmentVariablesService,
	rootDirectoryService,
	settingsResolutionService,
});
const broadcastToAllWindows = (channel: string, payload: unknown): void => {
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) {
			window.webContents.send(channel, payload);
		}
	}
};
const terminalService = createTerminalService({
	databaseService,
	onLifecycle: (event: TerminalLifecycleBroadcast) =>
		broadcastToAllWindows(IPC_CHANNELS.terminalLifecycle, event),
	onOutput: (event: TerminalOutputBroadcast) =>
		broadcastToAllWindows(IPC_CHANNELS.terminalOutput, event),
	workspaceEnvironmentService,
});
const scriptLifecycleService = createScriptLifecycleService({
	databaseService,
	settingsResolutionService,
	terminalService,
});
const createWorkspaceServiceWithSetup = withSetupScriptOnCreate({
	createWorkspaceService: createWorkspaceServiceInstance,
	scriptLifecycleService,
});
const archiveWorkspaceServiceWithScript = withArchiveScriptBeforeArchive({
	archiveWorkspaceService,
	scriptLifecycleService,
});
const linearAuthService = createLinearAuthService({
	configService,
	databaseService,
	openExternal: (url) => shell.openExternal(url),
	secretStoreFactory: (database) =>
		process.platform === 'darwin'
			? createMacosKeychainSecretStore({ database })
			: null,
});
const linearService = createLinearService({
	client: createLinearClient({
		getAccessToken: () => linearAuthService.getAccessToken(),
	}),
	databaseService,
});
const setupDiagnosticsService = createSetupDiagnosticsService({
	configService,
	databaseService,
	environmentVariablesService,
	linearAuthService,
	localCommandService,
	piExecutableService,
	piReadinessService,
	rootDirectoryService,
});
const openTargetService = createOpenTargetService({
	localCommandService,
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
		archiveWorkspaceService: archiveWorkspaceServiceWithScript,
		configService,
		createWorkspaceService: createWorkspaceServiceWithSetup,
		databaseService,
		deleteArchivedWorkspaceService,
		deleteRepositoryService,
		deleteWorkspaceService,
		environmentVariablesService,
		githubCloneService,
		githubRepositoryListService,
		linearAuthService,
		linearService,
		listArchivedWorkspacesService,
		listWorkspaceFilesService,
		localCommandService,
		localRepositoryImportService,
		localRepositoryRegistrationService,
		openTargetService,
		piExecutableService,
		piSessionService,
		quickStartProjectService,
		renameWorkspaceService,
		repositoryConfigService,
		rootDirectoryService,
		scriptLifecycleService,
		setupDiagnosticsService,
		settingsResolutionService,
		sharedRootAdoptionService,
		terminalService,
		unarchiveWorkspaceService,
	});
	terminalService.recoverStaleSessions();
	createMainWindow({ windowStateStore: mainWindowStateStore });
});

app.on('will-quit', () => {
	terminalService.disposeAll();
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
