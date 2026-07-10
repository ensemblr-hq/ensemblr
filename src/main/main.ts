import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { app, BrowserWindow, shell } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc/channels';
import type { AppSettingsChangedBroadcast } from '../shared/ipc/contracts/app-settings';
import type {
	PiRawFrameBroadcast,
	PiRawFrameKind,
	PiSessionEventBroadcast,
} from '../shared/ipc/contracts/pi-session';
import type {
	TerminalLifecycleBroadcast,
	TerminalOutputBroadcast,
} from '../shared/ipc/contracts/terminal';
import type { WorkspaceFilesChangedBroadcast } from '../shared/ipc/contracts/workspace-files';

import { createMainWindow } from './app/main-window';
import { createMainWindowStateStore } from './app/window-state';
import { createLocalCommandService } from './commands';
import {
	createAppSettingsService,
	createEnsemblrConfigResolutionService,
	createEnsemblrConfigService,
	createRepositoryConfigService,
	resolveEnsemblrConfigPath,
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
import { createAgentActivityMonitor } from './pi-agent/agent-activity-monitor';
import {
	electronIsAppFocused,
	electronNotify,
	electronPowerControls,
} from './pi-agent/electron-activity-bindings';
import { readMacosBattery } from './pi-agent/macos-battery';
import { createBranchNameQueue } from './pi-agent/pi-branch-name-service';
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
	createGithubUsernameResolver,
	createListAllWorkspacesService,
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
	createEnsemblrRootDirectoryService,
	reconcileRootDirectory,
} from './root';
import {
	createScriptLifecycleService,
	withArchiveScriptBeforeArchive,
	withSetupScriptOnCreate,
} from './scripts';
import { createMacosKeychainSecretStore } from './secrets';
import { createSetupDiagnosticsService } from './setup';
import {
	createEnsemblrDatabaseService,
	resolveDefaultDatabasePath,
} from './storage';
import { createTerminalService } from './terminal';
import {
	createListWorkspaceFilesService,
	createWorkspaceFilesWatcher,
} from './workspace-files';

// The dev build (`electron-forge start`, unpackaged) runs alongside the
// installed app while dogfooding. Isolate all of its persistent state so
// experimenting in dev can never mutate the app the user relies on. The config
// dir, DB dir, and keychain service derive from fixed path layouts / a
// reverse-DNS id rather than the app name, so `app.setName` below does not
// isolate them — each is overridden explicitly.
//
// `isDev` (main) and `import.meta.env.DEV` (renderer, drives the amber tint in
// `main.tsx`) are separate signals that MUST move together: `electron-forge
// start` is both unpackaged and Vite-dev, a packaged build is neither. A
// mismatch would isolate state without the warning tint, or tint a window that
// shares the installed app's state — keep the two in lockstep.
const isDev = !app.isPackaged;

// Marker for the two dev paths that share their production counterpart's
// namespace (DB data dir, workspace root). The config dir and keychain service
// live in different namespaces (dotfile path segment, reverse-DNS service id)
// and carry their own dev markers below.
const DEV_SUFFIX = ' (DEV)';
// The unpackaged dev build (`electron-forge start`) gets the explicit (DEV)
// suffix so it reads its isolated userData below. A *packaged* build keeps the
// product name forge baked in from its build channel (Ensemblr / Ensemblr
// Canary / Ensemblr Dev — see forge.config.ts + ADR 0032): that name derives
// the userData path and thus the single-instance lock, so each channel stays a
// distinct app. Clobbering to 'Ensemblr' here would collapse every packaged
// channel back onto the release identity — the shared registration that lets
// macOS relaunch a sibling build and flash a stray Dock tile.
if (isDev) {
	app.setName(`Ensemblr${DEV_SUFFIX}`);
}

// A second launch of the packaged app — most often a spawned login shell that
// re-execs the bundle's binary directly, which bypasses macOS LaunchServices
// dedup — would otherwise boot a whole second instance (its own Dock icon and
// window). Hold a single-instance lock so any such relaunch folds into the
// running instance via the `second-instance` handler below instead. The lock is
// a file lock under userData, so it catches direct-exec relaunches too, not just
// `open`-routed ones. Dev is excluded: dev builds share one `Ensemblr (DEV)`
// userData across Conductor workspaces, so a lock there would kill the second
// dogfooding instance. Acquired after `setName` so it keys on the right userData.
const hasSingleInstanceLock = isDev || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
	app.quit();
}

// Derive each dev path from its production resolver rather than hardcoding the
// layout, so dev tracks prod cross-platform (the DB resolver branches between
// macOS Application Support and XDG `.config`) and can never silently drift if
// the prod path changes. Each keeps its own dev marker in the namespace the
// prod path uses: the DB data dir is suffixed ` (DEV)`, while the `.config`
// dotfile dir takes an `ensemblr-dev` sibling (spaces/parens don't belong in a
// dotfile path segment).
const prodDatabasePath = resolveDefaultDatabasePath();
const devDatabasePath = path.join(
	path.dirname(prodDatabasePath) + DEV_SUFFIX,
	path.basename(prodDatabasePath),
);
const prodConfigPath = resolveEnsemblrConfigPath();
const devConfigPath = path.join(
	`${path.dirname(prodConfigPath)}-dev`,
	path.basename(prodConfigPath),
);
const devRootDirectory = path.join(os.homedir(), `Ensemblr${DEV_SUFFIX}`);
const devKeychainService = 'dev.ensemblr.app.secret-store.dev';

/**
 * Builds the macOS Keychain secret store shared by every service, swapping in
 * the isolated dev keychain service name when running the unpackaged dev build.
 * @param database - Open SQLite handle the store persists its metadata into.
 * @returns The secret store, or `null` on non-darwin platforms.
 */
const createSecretStore = (database: DatabaseSync) =>
	process.platform === 'darwin'
		? createMacosKeychainSecretStore({
				database,
				...(isDev ? { serviceName: devKeychainService } : {}),
			})
		: null;

const configService = createEnsemblrConfigService(
	isDev ? { configPath: devConfigPath } : {},
);
const appSettingsService = createAppSettingsService(
	isDev ? { configPath: devConfigPath } : {},
);
// Drives the caffeinate power-blocker + "Pi finished" desktop notifications,
// gated live by the General settings in config.json.
const agentActivityMonitor = createAgentActivityMonitor({
	isAppFocused: electronIsAppFocused,
	notify: electronNotify,
	powerControls: electronPowerControls,
	readBattery: readMacosBattery,
	readSettings: () => appSettingsService.read(),
});
const databaseService = createEnsemblrDatabaseService(
	isDev ? { databasePath: devDatabasePath } : {},
);
const localCommandService = createLocalCommandService();
const environmentVariablesService = createEnvironmentVariablesService({
	configService,
	databaseService,
	secretStoreFactory: createSecretStore,
});
const settingsResolutionService = createEnsemblrConfigResolutionService({
	appSettingsService,
	configService,
	databaseService,
	rootDirectory: isDev ? devRootDirectory : undefined,
});
const repositoryConfigService = createRepositoryConfigService();
const rootDirectoryService = createEnsemblrRootDirectoryService({
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
 * Ensemblr jobs (chat-title generation, session-summary generation). It is
 * derived from the session label so the same broadcast funnel covers both
 * the main client and the summary client.
 */
const classifyRawFrameKind = (label: string): PiRawFrameKind => {
	if (label === 'ensemblr-chat-title') {
		return 'title';
	}
	if (label === 'ensemblr-session-summary') {
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
/**
 * Base environment for every spawned Pi child. Uses the login-shell env (with
 * the user's PATH) so a packaged app launched from Finder — whose `process.env`
 * PATH is minimal — still lets pi find its runtime and tools instead of exiting
 * on startup and surfacing later as an EPIPE on the first prompt write. Memoized
 * inside `localCommandService`, so repeated opens do not re-spawn a shell.
 */
const resolvePiSpawnEnv = async (): Promise<NodeJS.ProcessEnv> =>
	(await localCommandService.getEnvironment()).env;
const piAgentAdapter = createCliRpcPiAgentAdapter({
	onRawFrame: broadcastRawFrame,
	resolveBaseEnv: resolvePiSpawnEnv,
});
const piAgentClient = createPiAgentClient({ adapter: piAgentAdapter });
const summaryPiAgentAdapter = createCliRpcPiAgentAdapter({
	onRawFrame: broadcastRawFrame,
	resolveBaseEnv: resolvePiSpawnEnv,
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
const renameWorkspaceService = createRenameWorkspaceService({
	databaseService,
	localCommandService,
});
// Best-effort auto branch-naming after the first turn: renames a placeholder
// workspace + its branch to an LLM-suggested name. Gated by the
// `renameWorkspaceOnBranch` user setting and placeholder metadata.
const branchNameQueue = createBranchNameQueue({
	appSettingsService,
	renameWorkspace: renameWorkspaceService.rename,
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
		agentActivityMonitor.handle({ event: payload.event, sessionId });
	},
	piAgentClient,
	queueBranchName: branchNameQueue,
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
const githubUsernameResolver = createGithubUsernameResolver({
	localCommandService,
});
const quickStartProjectService = createQuickStartProjectService({
	localCommandService,
	registrationService: localRepositoryRegistrationService,
	rootDirectoryService,
});
const createWorkspaceServiceInstance = createWorkspaceService({
	databaseService,
	githubUsernameResolver,
	localCommandService,
	readGitDefaults: () => appSettingsService.read().git,
	rootDirectoryService,
});
const sharedRootAdoptionService = createSharedRootAdoptionService({
	databaseService,
	rootDirectoryService,
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
const listAllWorkspacesService = createListAllWorkspacesService({
	databaseService,
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
});
const broadcastToAllWindows = (channel: string, payload: unknown): void => {
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) {
			window.webContents.send(channel, payload);
		}
	}
};
const workspaceFilesWatcher = createWorkspaceFilesWatcher({
	onChange: (workspaceCwd) =>
		broadcastToAllWindows(IPC_CHANNELS.workspaceFilesChanged, {
			workspaceCwd,
		} satisfies WorkspaceFilesChangedBroadcast),
});
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
	secretStoreFactory: createSecretStore,
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
	// The instance that lost the single-instance lock is already quitting; skip
	// state loading and window creation so it never touches shared userData.
	if (!hasSingleInstanceLock) {
		return;
	}

	configService.load();
	databaseService.open();
	rootDirectoryService.ensure();
	void sharedRootAdoptionService.reconcile();
	installApplicationMenu();
	// config.json is the source of truth; live-reload the renderer when it's
	// edited outside the app (the service suppresses echoes of its own writes).
	appSettingsService.startWatching((settings) => {
		broadcastToAllWindows(IPC_CHANNELS.appSettingsChanged, {
			settings,
		} satisfies AppSettingsChangedBroadcast);
		agentActivityMonitor.refresh();
	});
	registerIpcHandlers({
		appSettingsService,
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
		listAllWorkspacesService,
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
		onAppSettingsUpdated: () => agentActivityMonitor.refresh(),
		repositoryConfigService,
		rootDirectoryService,
		scriptLifecycleService,
		setupDiagnosticsService,
		settingsResolutionService,
		sharedRootAdoptionService,
		terminalService,
		unarchiveWorkspaceService,
		workspaceFilesWatcher,
	});
	terminalService.recoverStaleSessions();
	createMainWindow({ windowStateStore: mainWindowStateStore });
});

app.on('will-quit', () => {
	appSettingsService.stop();
	agentActivityMonitor.dispose();
	terminalService.disposeAll();
	workspaceFilesWatcher.stopAll();
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

// A blocked second launch (see the single-instance lock above) fires this in the
// already-running instance. Surface the existing window instead of letting a new
// instance spawn; recreate only if every window was closed (on macOS the app
// stays alive with no windows).
app.on('second-instance', (_event, argv, workingDirectory) => {
	// Forensics for the Dock-flash bug: record who exec'd the blocked instance
	// so a surviving relaunch trigger can be identified from Console.app.
	console.warn('[single-instance] blocked a second launch', {
		argv,
		workingDirectory,
	});
	const [existing] = BrowserWindow.getAllWindows();
	if (existing) {
		if (existing.isMinimized()) {
			existing.restore();
		}
		existing.focus();
		return;
	}
	createMainWindow({ windowStateStore: mainWindowStateStore });
});
