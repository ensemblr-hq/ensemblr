import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc/channels';
import type { AppSettingsChangedBroadcast } from '../shared/ipc/contracts/app-settings';
import type { ConfigChangedBroadcast } from '../shared/ipc/contracts/health';
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
import { scrollbackMbToBytes } from '../shared/terminal/scrollback';
import {
	type AgentControlService,
	type BoardStatusStore,
	type ControlServer,
	createAgentControlIntegration,
	createAgentControlPorts,
	createAgentControlService,
	createBoardStatusStore,
	createGuardrails,
	createOriginRegistry,
	startControlServer,
} from './agent-control';
import { createHarnessDetectionService } from './agents/harness-detection-service.ts';
import { createMainWindow } from './app/main-window';
import { createMainWindowStateStore } from './app/window-state';
import { createChatTabService } from './chat-tabs/chat-tab-service.ts';
import { persistTerminalAgentSessionId } from './chat-tabs/persist-terminal-agent-session.ts';
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
	createToolchainPathResolver,
	createWorkspaceEnvironmentService,
} from './environment';
import { type IpcHandlersHandle, registerIpcHandlers } from './ipc';
import { readPermissionModeFromSnapshot } from './ipc/permission-gate.ts';
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
import { createSessionNaming } from './pi-agent/naming/session-naming';
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
import { getWorkspacePathById } from './storage/repositories/workspace-repository.ts';
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
	// `exit(0)`, not `quit()`: this doomed instance still ran the whole module and
	// registered `before-quit` below, which preventDefaults and races a 3s Pi
	// shutdown. `quit()` would drag the loser through that path; `exit` fetches an
	// immediate teardown so the relaunch folds into the primary at once. Safe
	// because nothing owning shared userData has started yet — every real side
	// effect (DB open, window, IPC) sits behind the `hasSingleInstanceLock` guard
	// in `whenReady`, so the module-scope service graph below must stay construction
	// -only (no filesystem/userData writes in a constructor) for this to hold.
	app.exit(0);
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
	/** Reads the latest app settings so the monitor can gate itself live. */
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
/**
 * Fan out a raw Pi RPC frame sample to every live renderer window for the debug
 * panel.
 * @param sample - Captured frame with direction, label, and JSONL line.
 */
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
// ---------------------------------------------------------------------------
// Agent control layer. Lets Pi and third-party harness agents drive the app
// from inside their own sessions (spawn tabs, launch harnesses, start/stop
// terminals). The loopback control server is started once its delegating
// services exist (below); `resolveAgentControlEnv` hands each spawned agent its
// per-workspace token plus the server URL so its control tools can call back.
// ---------------------------------------------------------------------------
const agentControlOriginRegistry = createOriginRegistry();
const agentControlGuardrails = createGuardrails();
let agentControlServer: ControlServer | null = null;
// Assigned once its delegating services exist (below); the pi event sink is
// wired before that point, so it reads this ref lazily to release a session's
// control state on shutdown.
let agentControlService: AgentControlService | null = null;

// The env resolver, harness-command augmenter, native confirm dialog, and
// resolved Pi extension path all live behind one integration factory; main.ts
// keeps only the composition. `getServerUrl` reads the mutable server ref
// lazily, so the resolver returns an empty overlay until the server is up.
const {
	resolveAgentControlEnv,
	augmentHarnessCommand,
	confirmAgentControlAction,
	piControlExtensionPath,
} = createAgentControlIntegration({
	app,
	originRegistry: agentControlOriginRegistry,
	resolveWorkspaceCwd: (workspaceId) => {
		const database = databaseService.getConnection()?.database;
		return database ? getWorkspacePathById({ database, workspaceId }) : null;
	},
	getServerUrl: () => agentControlServer?.url ?? null,
});

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
const piAgentClient = createPiAgentClient({
	adapter: piAgentAdapter,
	args: piControlExtensionPath
		? ['--mode', 'rpc', '-e', piControlExtensionPath]
		: undefined,
});
const summaryPiAgentAdapter = createCliRpcPiAgentAdapter({
	onRawFrame: broadcastRawFrame,
	resolveBaseEnv: resolvePiSpawnEnv,
});
const summaryPiAgentClient = createPiAgentClient({
	adapter: summaryPiAgentAdapter,
});
const sessionSummaryWriter = createSessionSummaryWriter({
	piAgentClient: summaryPiAgentClient,
	/** Resolves the current Pi executable snapshot, or null when unavailable. */
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
// Unified best-effort naming after the first (and each subsequent) turn: one
// throwaway Pi session names the chat tab and, when the `renameWorkspaceOnBranch`
// setting is on and the workspace still carries its placeholder name, renames the
// workspace + git branch. Self-gates per field so it never clobbers a settled name.
const sessionNamingQueue = createSessionNaming({
	appSettingsService,
	piAgentClient,
	renameWorkspace: renameWorkspaceService.rename,
});
const piSessionService = createPiSessionService({
	databaseService,
	/** Forwards a Pi session event to every window and the activity monitor. */
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
		if (event.eventType === 'shutdown') {
			agentControlService?.releaseSession(sessionId);
		}
	},
	piAgentClient,
	queueNaming: sessionNamingQueue,
	resolveAgentControlEnv,
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
	/** Reads the user's default git settings for new workspaces. */
	readGitDefaults: () => appSettingsService.read().git,
	/** Resolves the repo's configured branchFrom base for new workspaces. */
	readRepositorySettings: (request) =>
		settingsResolutionService.resolve(request),
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
	resolveToolchainPath: createToolchainPathResolver(localCommandService),
	rootDirectoryService,
});
/**
 * Send an IPC payload to every live renderer window.
 * @param channel - IPC channel to send on.
 * @param payload - Data to deliver to each window.
 */
const broadcastToAllWindows = (channel: string, payload: unknown): void => {
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) {
			window.webContents.send(channel, payload);
		}
	}
};
let ipcHandlersHandle: IpcHandlersHandle | null = null;
const workspaceFilesWatcher = createWorkspaceFilesWatcher({
	/** Broadcasts a workspace-files-changed event when the watcher fires. */
	onChange: (workspaceCwd) =>
		broadcastToAllWindows(IPC_CHANNELS.workspaceFilesChanged, {
			workspaceCwd,
		} satisfies WorkspaceFilesChangedBroadcast),
});
const terminalService = createTerminalService({
	databaseService,
	/** Persists a harness's native session id onto its tab for exact resume. */
	onAgentSessionCaptured: ({ agentSessionId, terminalId, workspaceId }) =>
		persistTerminalAgentSessionId({
			agentSessionId,
			database: databaseService.getConnection()?.database ?? null,
			terminalId,
			workspaceId,
		}),
	/** Broadcasts a terminal lifecycle event to all windows. */
	onLifecycle: (event: TerminalLifecycleBroadcast) =>
		broadcastToAllWindows(IPC_CHANNELS.terminalLifecycle, event),
	/** Broadcasts terminal output to all windows. */
	onOutput: (event: TerminalOutputBroadcast) =>
		broadcastToAllWindows(IPC_CHANNELS.terminalOutput, event),
	resolveAgentControlEnv,
	/** Resolves the shell-derived base environment for terminal and script PTYs. */
	resolveBaseEnv: async () => (await localCommandService.getEnvironment()).env,
	/** Sizes each pty scrollback buffer from the user's terminal-scrollback setting. */
	resolveScrollbackLimit: () =>
		scrollbackMbToBytes(
			appSettingsService.read().appearance.terminalScrollbackMb,
		),
	workspaceEnvironmentService,
});
const scriptLifecycleService = createScriptLifecycleService({
	databaseService,
	settingsResolutionService,
	terminalService,
});
const harnessDetectionService = createHarnessDetectionService({
	localCommandService,
});
const agentControlChatTabService = createChatTabService({
	databaseService,
	lookups: {
		piSessionExists: ({ piSessionId }) =>
			piSessionService.getSession(piSessionId) !== null,
	},
});
const boardStatusStore: BoardStatusStore = createBoardStatusStore();
ipcMain.handle(
	IPC_CHANNELS.agentControlReportBoardStatus,
	(_event, statusByWorkspaceId: unknown) => {
		boardStatusStore.replaceAll(
			(statusByWorkspaceId ?? {}) as Record<string, unknown>,
		);
	},
);
agentControlService = createAgentControlService({
	guardrails: agentControlGuardrails,
	originRegistry: agentControlOriginRegistry,
	ports: createAgentControlPorts({
		augmentHarnessCommand,
		boardStatusStore,
		broadcastBoardStatus: (payload) =>
			broadcastToAllWindows(IPC_CHANNELS.agentControlBoardStatus, payload),
		broadcastFocus: (payload) =>
			broadcastToAllWindows(IPC_CHANNELS.agentControlFocusView, payload),
		broadcastTabsChanged: (payload) =>
			broadcastToAllWindows(IPC_CHANNELS.agentControlTabsChanged, payload),
		chatTabService: agentControlChatTabService,
		confirm: { confirm: confirmAgentControlAction },
		databaseService,
		getPermissionMode: () =>
			readPermissionModeFromSnapshot(settingsResolutionService.resolve()),
		harnessDetectionService,
		localCommandService,
		piExecutableService,
		piSessionService,
		scriptLifecycleService,
		terminalService,
	}),
});
startControlServer(agentControlService)
	.then((server) => {
		agentControlServer = server;
	})
	.catch((error: unknown) => {
		console.error('[agent-control] failed to start control server', error);
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
	/** Opens an external URL in the user's default browser. */
	openExternal: (url) => shell.openExternal(url),
	secretStoreFactory: createSecretStore,
});
const linearService = createLinearService({
	client: createLinearClient({
		/** Resolves the current Linear access token from the auth service. */
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
	// Live-reload the non-App config sections (linear, security, managed,
	// environment, repositoryDefaults, repositoryRules) so external config.json
	// edits take effect without a restart.
	configService.startWatching((snapshot) => {
		broadcastToAllWindows(IPC_CHANNELS.configChanged, {
			snapshot,
		} satisfies ConfigChangedBroadcast);
	});
	ipcHandlersHandle = registerIpcHandlers({
		appSettingsService,
		archiveRepositoryService,
		archiveWorkspaceService: archiveWorkspaceServiceWithScript,
		augmentHarnessCommand,
		configService,
		createWorkspaceService: createWorkspaceServiceWithSetup,
		databaseService,
		deleteArchivedWorkspaceService,
		deleteRepositoryService,
		deleteWorkspaceService,
		environmentVariablesService,
		githubCloneService,
		githubRepositoryListService,
		harnessDetectionService,
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

let isShuttingDownAgents = false;
// Terminate the Pi RPC children before the process exits. `close()` now resolves
// only once each child has actually exited, so awaiting the client shutdowns
// keeps orphaned `pi --mode rpc` processes from surviving app quit. `before-quit`
// is synchronous, so defer the real quit until the async shutdown settles; a
// bounded race guarantees a wedged child can never block quit indefinitely.
app.on('before-quit', (event) => {
	if (isShuttingDownAgents) {
		return;
	}
	isShuttingDownAgents = true;
	event.preventDefault();
	void (async () => {
		await Promise.race([
			Promise.allSettled([
				piAgentClient.shutdown(),
				summaryPiAgentClient.shutdown(),
			]),
			new Promise((resolve) => setTimeout(resolve, 3000)),
		]);
		app.quit();
	})();
});

app.on('will-quit', () => {
	appSettingsService.stop();
	configService.stop();
	agentActivityMonitor.dispose();
	void agentControlServer?.close();
	terminalService.disposeAll();
	ipcHandlersHandle?.dispose();
	workspaceFilesWatcher.stopAll();
	databaseService.close();
});

// Quit once the last window closes on every platform, macOS included. Ensemblr is
// a single-window workbench, not a menu-bar resident, so keeping the process (and
// its Pi RPC children) alive with no windows just wastes resources and leaves a
// stray Dock tile. `before-quit` still drives the graceful Pi shutdown.
app.on('window-all-closed', () => {
	app.quit();
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
