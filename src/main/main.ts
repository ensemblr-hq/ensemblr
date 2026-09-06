import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
	app,
	autoUpdater,
	BrowserWindow,
	dialog,
	ipcMain,
	nativeTheme,
	safeStorage,
	shell,
} from 'electron';
import {
	awarenessForAudience,
	buildCoAuthorDirective,
	buildLanguageDirective,
	parseAskUserQuestionReply,
	parseReviewBriefReply,
	resolveAgentRole,
} from '../shared/agent-control.ts';
import type { AgentProviderId } from '../shared/agent-provider.ts';
import { DEFAULT_APP_SETTINGS } from '../shared/config.ts';
import {
	type AppLanguage,
	FALLBACK_LANGUAGE,
	resolveLanguage,
} from '../shared/i18n.ts';
import { IPC_CHANNELS } from '../shared/ipc/channels';
import type {
	AgentSessionEventBroadcast,
	PiRawFrameBroadcast,
	PiRawFrameKind,
} from '../shared/ipc/contracts/agent-session';
import type { AppSettingsChangedBroadcast } from '../shared/ipc/contracts/app-settings';
import type { ArchitectureSnapshotChangedBroadcast } from '../shared/ipc/contracts/architecture';
import type { ConfigChangedBroadcast } from '../shared/ipc/contracts/health';
import type {
	TerminalLifecycleBroadcast,
	TerminalOutputBroadcast,
} from '../shared/ipc/contracts/terminal';
import type { UpdateStatusChangedBroadcast } from '../shared/ipc/contracts/update';
import type { WorkspaceFilesChangedBroadcast } from '../shared/ipc/contracts/workspace-files';
import { scrollbackMbToBytes } from '../shared/terminal.ts';
import { resolveWindowChrome } from '../shared/window-chrome.ts';
import { createAfkModeRegistry } from './afk-mode';
import {
	type AgentControlService,
	type BoardStatusStore,
	CONTROL_TOKEN_ENV_KEY,
	CONTROL_URL_ENV_KEY,
	type ControlServer,
	createAgentControlIntegration,
	createAgentControlPorts,
	createAgentControlService,
	createAskUserQuestionCoordinator,
	createBoardStatusStore,
	createGuardrails,
	createOriginRegistry,
	createReviewLaunchCoordinator,
	isSessionTabMarkedSubAgent,
	makeReviewBriefFallback,
	readWorkspaceLinkedIssue,
	startControlServer,
} from './agent-control';
import {
	createAgentModelCatalog,
	createAgentProviderService,
	createClaudeExecutableService,
	createClaudeReadinessProbe,
	createPiReadinessProbe,
	createSpawnModelResolver,
} from './agent-providers';
import {
	type AgentExecutableSnapshot,
	createAgentClient,
	usesNativeControlMcp,
	WORKSPACE_REMOVED_STOP_REASON,
} from './agent-runtime';
import { ActiveChatStore } from './agent-runtime/active-chat-store';
import { createAgentActivityMonitor } from './agent-runtime/agent-activity-monitor';
import { createAgentSessionService } from './agent-runtime/agent-session-service';
import {
	electronAnnounceTurnFinished,
	electronIsAppFocused,
	electronNotify,
	electronPowerControls,
} from './agent-runtime/electron-activity-bindings';
import { readLinuxBattery } from './agent-runtime/linux-battery';
import { readMacosBattery } from './agent-runtime/macos-battery';
import { createProvisionalWorkspaceNaming } from './agent-runtime/naming/provisional-workspace-naming';
import { createSessionNaming } from './agent-runtime/naming/session-naming';
import { resolveNotificationTarget } from './agent-runtime/notification-target';
import { createSessionSummaryWriter } from './agent-runtime/session-summary-writer';
import { resolveAgentSkillBundle } from './agent-skills';
import { createHarnessDetectionService } from './agents';
import { applyLinuxDesktopIdentity } from './app/linux-desktop-identity';
import { createMainWindow } from './app/main-window';
import type { QuitExit } from './app/quit-coordinator';
import { createQuitCoordinator } from './app/quit-coordinator';
import { createQuitGuard } from './app/quit-guard';
import { resolveUserDataDirectory } from './app/user-data-location';
import { resolveWindowBackgroundColor } from './app/window-background';
import { createMainWindowStateStore } from './app/window-state';
import { createArchitectureService } from './architecture';
import { createChatTabService } from './chat-tabs/chat-tab-service.ts';
import { persistTerminalAgentSessionId } from './chat-tabs/persist-terminal-agent-session.ts';
import {
	createClaudeAgentAdapter,
	createClaudeMcpRoster,
	createClaudeModelLister,
	createClaudePlanBridge,
	createClaudeSlashCommands,
} from './claude-agent';
import { installClaudeToolApproval } from './claude-agent/claude-tool-approval-ipc.ts';
import { createLocalCommandService } from './commands';
import {
	createConciergeMemoryService,
	createConciergeSessionService,
	ensureConciergeHome,
	resolveConciergeHome,
} from './concierge';
import {
	createAppSettingsService,
	createEnsemblrConfigResolutionService,
	createEnsemblrConfigService,
	createRepositoryConfigService,
	migrateAllRepositoryScriptSettings,
	resolveEnsemblrConfigPath,
} from './config';
import { createDictationService } from './dictation';
import {
	createEnvironmentVariablesService,
	createToolchainPathResolver,
	createWorkspaceEnvironmentService,
} from './environment';
import {
	createInfisicalAccountStore,
	createInfisicalApi,
	createInfisicalCache,
	createInfisicalClient,
	createInfisicalLinkStore,
	createInfisicalService,
	type InfisicalService,
} from './infisical';
import { type IpcHandlersHandle, registerIpcHandlers } from './ipc';
import { trackWindowMaximizedState } from './ipc/handlers/window.ts';
import { readPermissionModeFromSnapshot } from './ipc/permission-gate.ts';
import {
	createLinearAssetProxy,
	createLinearAuthService,
	createLinearClient,
	createLinearService,
	registerLinearAssetProtocol,
	registerLinearAssetScheme,
} from './linear';
import { installApplicationMenu, MenuBarStore, MenuContextStore } from './menu';
import { createOpenTargetService } from './open-target';
import { createPiCliRpcAdapter, resolvePiSlashCommands } from './pi-agent';
import {
	createPiExecutableService,
	createPiReadinessService,
} from './pi-runtime';
import {
	createPlanFileWriter,
	createPlanModeRegistry,
	createPlanSubmission,
} from './plan-mode';
import {
	createArchiveLifecycleService,
	createArchiveWorkspaceService,
	createContinueWorkspaceBranchService,
	createDeleteArchivedWorkspaceService,
	createDeleteRepositoryService,
	createDeleteWorkspaceService,
	createGithubCloneService,
	createGithubOwnerListService,
	createGithubRemoteBranchListService,
	createGithubRepositoryListService,
	createGithubUsernameResolver,
	createListAllWorkspacesService,
	createListArchivedWorkspacesService,
	createLocalRepositoryImportService,
	createLocalRepositoryRegistrationService,
	createQuickStartProjectService,
	createRenameWorkspaceService,
	createSetWorkspaceBaseBranchService,
	createSharedRootAdoptionService,
	createUnarchiveWorkspaceService,
	createWorkspaceDiskSweepService,
	createWorkspaceService,
	createWorkspaceTeardownService,
} from './repository';
import { createReviewService } from './review';
import {
	createEnsemblrRootDirectoryService,
	reconcileRootDirectory,
} from './root';
import {
	createScriptLifecycleService,
	withArchiveScriptBeforeArchive,
	withSetupScriptOnCreate,
} from './scripts';
import {
	createMacosKeychainSecretStore,
	createSafeStorageSecretStore,
} from './secrets';
import { createSetupDiagnosticsService } from './setup';
import {
	createEnsemblrDatabaseService,
	resolveDefaultDatabasePath,
} from './storage';
import { getChatTabByAgentSessionId } from './storage/repositories/chat-tab-repository.ts';
import { getWorkspacePathById } from './storage/repositories/workspace-repository.ts';
import { createTerminalService } from './terminal';
import { createAppUpdateService } from './updates';
import {
	createListWorkspaceFilesService,
	createWorkspaceFilesWatcher,
} from './workspace-files';
import { createWorkspaceGitService } from './workspace-git';

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
// Canary / Ensemblr Dev — see forge.config.ts + ADR 0032), because that name is
// what distinguishes the channels in the Dock, the menu bar and Launch
// Services. Clobbering it to 'Ensemblr' here would collapse every packaged
// channel back onto the release identity — the shared registration that lets
// macOS relaunch a sibling build and flash a stray Dock tile.
if (isDev) {
	app.setName(`Ensemblr${DEV_SUFFIX}`);
}

// The Linux counterpart of the identity above: the product name drives the Dock
// and Launch Services on macOS, the desktop-entry name drives the XDG app id and
// `WM_CLASS` on Linux. Runs for dev too, so a dogfooding window is as
// rule-addressable as a packaged one.
applyLinuxDesktopIdentity();

// A packaged dogfood channel is the same install wearing a different name, so
// it opens the release's state rather than a blank one. The SQLite database and
// `~/.config/ensemblr/config.json` are already channel-independent — keyed on
// `dev.ensemblr.app` and the home directory rather than the product name — and
// only Electron's own userData followed the channel, stranding the
// localStorage-backed recents, workspace selection and per-repo overrides in a
// sibling directory. Pinning it to the release's directory also puts every
// packaged channel behind one single-instance lock, which is the correct
// reading now that they share one database file: two channels open on it at
// once was never safe. This amends ADR 0032, whose bundle-id split stands.
// `setPath` throws when the directory does not exist, which is the ordinary case
// on a machine that installed a dogfood channel before ever installing a
// release, so create it first. It also has to run before `ready`: `sessionData`
// defaults to `userData`, and Electron only reads it once.
//
// Resolved from the config path, which is why that pair is derived here rather
// than beside the other dev paths further down.
const prodConfigPath = resolveEnsemblrConfigPath();
const devConfigPath = path.join(
	`${path.dirname(prodConfigPath)}-dev`,
	path.basename(prodConfigPath),
);
const userDataDirectory = resolveUserDataDirectory({
	appDataPath: app.getPath('appData'),
	configPath: isDev ? devConfigPath : prodConfigPath,
	isDev,
	platform: process.platform,
});
if (userDataDirectory) {
	mkdirSync(userDataDirectory, { recursive: true });
	app.setPath('userData', userDataDirectory);
}

// A second launch of the packaged app — most often a spawned login shell that
// re-execs the bundle's binary directly, which bypasses macOS LaunchServices
// dedup — would otherwise boot a whole second instance (its own Dock icon and
// window). Hold a single-instance lock so any such relaunch folds into the
// running instance via the `second-instance` handler below instead. The lock is
// a file lock under userData, so it catches direct-exec relaunches too, not just
// `open`-routed ones. Dev is excluded: dev builds share one `Ensemblr (DEV)`
// userData across dogfooding workspaces, so a lock there would kill the second
// dogfooding instance. Acquired after the userData pin so it keys on the right
// directory.
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
// dotfile path segment) — that pair is derived above, because the Linux
// userData directory hangs off it.
const prodDatabasePath = resolveDefaultDatabasePath();
const devDatabasePath = path.join(
	path.dirname(prodDatabasePath) + DEV_SUFFIX,
	path.basename(prodDatabasePath),
);
const devRootDirectory = path.join(os.homedir(), `Ensemblr${DEV_SUFFIX}`);
const devKeychainService = 'dev.ensemblr.app.secret-store.dev';

/**
 * Builds the platform's secret store, shared by every service: the macOS
 * Keychain on darwin, Electron's `safeStorage` on Linux. Both swap in the
 * isolated dev service name when running the unpackaged dev build, so a dev
 * build never reads or overwrites the release's entries.
 * @param database - Open SQLite handle the store persists its metadata into.
 * @returns The secret store, or `null` on a platform with neither backend.
 */
const createSecretStore = (database: DatabaseSync) => {
	const serviceNameOverride = isDev ? { serviceName: devKeychainService } : {};

	if (process.platform === 'darwin') {
		return createMacosKeychainSecretStore({
			database,
			...serviceNameOverride,
		});
	}

	if (process.platform === 'linux') {
		return createSafeStorageSecretStore({ database, ...serviceNameOverride });
	}

	return null;
};

/**
 * Reads the battery through whichever mechanism the platform offers, so the
 * power-save blocker releases on a draining laptop everywhere rather than only
 * on macOS. A platform with neither reader reports `null`, which the monitor
 * treats as "no battery limit".
 * @returns The current battery snapshot, or `null` when it cannot be read.
 */
const readPlatformBattery = () =>
	process.platform === 'linux' ? readLinuxBattery() : readMacosBattery();

const configService = createEnsemblrConfigService(
	isDev ? { configPath: devConfigPath } : {},
);
const appSettingsService = createAppSettingsService(
	isDev ? { configPath: devConfigPath } : {},
);
const databaseService = createEnsemblrDatabaseService(
	isDev ? { databasePath: devDatabasePath } : {},
);

/**
 * Whether the experimental architecture diagram feature is on. Read live rather
 * than captured at launch: it gates the diagram pane, the two control ops, the
 * shipped skill, and the playbooks that describe them, and the settings file is
 * watched, so a session opened after the switch flips gets the surface the user
 * just asked for.
 * @returns True when the user has enabled the architecture diagram.
 */
const readArchitectureDiagramEnabled = (): boolean =>
	appSettingsService.read().experimental.architectureDiagram;
/**
 * Reads the user's "third-party CLI harnesses" setting. Read per call for the
 * same reason the diagram flag is: it gates the launcher, its menu item, the
 * `launchHarness` op, and the playbooks that describe them, and the settings file
 * is watched, so a session opened after the switch flips gets what the user just
 * asked for.
 * @returns True when the user has enabled third-party CLI harnesses.
 */
const readTuiHarnessesEnabled = (): boolean =>
	appSettingsService.read().experimental.tuiHarnesses;
/**
 * Reads the user's "Credit Ensemblr as a commit co-author" setting, which puts
 * the trailer block into the playbooks an agent receives. Read per call rather
 * than captured, and for the same reason the diagram flag is: the settings file
 * is watched, so a session opened after the switch flips gets the block.
 * @returns True unless the user has switched the credit off.
 */
const readCoAuthorEnabled = (): boolean =>
	appSettingsService.read().git.coAuthorEnsemblr;
// The chat the renderer last reported as on screen, so a desktop notification is
// suppressed for that chat alone rather than for the whole app.
const activeChatStore = new ActiveChatStore();
// Drives the caffeinate power-blocker + "agent finished" desktop notifications,
// gated live by the General settings in config.json.
const agentActivityMonitor = createAgentActivityMonitor({
	announceTurnFinished: electronAnnounceTurnFinished,
	isAppFocused: electronIsAppFocused,
	/** Reports whether the user is looking at exactly this chat right now. */
	isChatOnScreen: (chat) => activeChatStore.isOnScreen(chat),
	/** Reports whether the Concierge panel is the surface in front of the user. */
	isConciergeOnScreen: () => activeChatStore.isConciergeOnScreen(),
	notify: electronNotify,
	powerControls: electronPowerControls,
	readBattery: readPlatformBattery,
	/** Resolves the language notification copy is rendered in. */
	readLanguage: () => resolveAppLanguage(),
	/** Reads the latest app settings so the monitor can gate itself live. */
	readSettings: () => appSettingsService.read(),
	/** Names the workspace and tab a notification describes, and spots sub-agents. */
	resolveTarget: (workspaceId, agentSessionId) =>
		resolveNotificationTarget(
			databaseService.getConnection()?.database,
			workspaceId,
			agentSessionId,
		),
});
const localCommandService = createLocalCommandService();

// Rebuilt whenever the underlying connection changes, because the account store,
// the value cache, and the link store all bind to one open SQLite handle.
let infisicalRuntime: {
	database: DatabaseSync;
	service: InfisicalService;
} | null = null;

/**
 * Resolves the Infisical service against the currently open database, building
 * it on first use. Returns null before the database is open, which is the same
 * answer as "nothing is linked".
 * @returns The Infisical service, or null when storage is unavailable.
 */
const getInfisicalService = (): InfisicalService | null => {
	const database = databaseService.getConnection()?.database ?? null;

	if (!database) {
		infisicalRuntime = null;
		return null;
	}

	if (infisicalRuntime?.database === database) {
		return infisicalRuntime.service;
	}

	const secretStore = createSecretStore(database);
	const accountStore = createInfisicalAccountStore({ database, secretStore });
	const service = createInfisicalService({
		accountStore,
		cache: createInfisicalCache({ secretStore }),
		client: createInfisicalClient({ accountStore, api: createInfisicalApi() }),
		linkStore: createInfisicalLinkStore({ database }),
	});

	infisicalRuntime = { database, service };

	return service;
};

const environmentVariablesService = createEnvironmentVariablesService({
	configService,
	databaseService,
	/**
	 * Resolves a scope's linked Infisical values for the environment layer. App
	 * scope is never linked, and an unavailable service resolves to nothing
	 * rather than failing the assembly.
	 */
	resolveInfisical: async (scope) => {
		const empty = { degradedReason: null, values: {} } as const;

		if (scope.scope === 'app') {
			return empty;
		}

		return (
			(await getInfisicalService()?.resolveForScope({
				scope: scope.scope,
				scopeId: scope.scopeId,
			})) ?? empty
		);
	},
	secretStoreFactory: createSecretStore,
});
const dictationService = createDictationService({
	/** Hands the service the open SQLite handle its secret store persists into. */
	databaseFactory: () => databaseService.getConnection()?.database ?? null,
	/** Reads the latest dictation settings so a config edit applies to the next clip. */
	readSettings: () => appSettingsService.read(),
	secretStoreFactory: createSecretStore,
});
const settingsResolutionService = createEnsemblrConfigResolutionService({
	appSettingsService,
	configService,
	databaseService,
	rootDirectory: isDev ? devRootDirectory : undefined,
});
/**
 * Resolves the language the app is rendering in, the same way the native menu
 * and the shell snapshot do. Read per call rather than captured so a language
 * the user switches mid-session reaches the next agent turn, and defensive
 * because it runs on the agent-control path: a settings read that throws must
 * not take a harness launch or a turn's prompt down with it.
 * @returns The resolved app language, falling back to English.
 */
const resolveAppLanguage = (): AppLanguage => {
	try {
		return resolveLanguage(
			appSettingsService.read().general.language,
			app.getPreferredSystemLanguages(),
		);
	} catch {
		return FALLBACK_LANGUAGE;
	}
};
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
const claudeExecutableService = createClaudeExecutableService({
	databaseService,
	localCommandService,
	settingsResolutionService,
});
/**
 * Debug-only fan-out for raw Pi RPC frames. Pipes every JSONL line that
 * crosses the boundary (rx + tx) to all renderer windows so the temporary
 * debug panel can inspect them while iterating on conversation UI. Never
 * persisted; subscribers may discard frames at will.
 *
 * `kind` lets the renderer scope traffic to user-facing chat. It is derived
 * from the session label; every ephemeral Ensemblr job that used to have its
 * own label is gone, so anything that is not a chat session is `unknown`.
 */
const classifyRawFrameKind = (label: string): PiRawFrameKind =>
	label === 'pi-agent-session' ? 'chat' : 'unknown';
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

/**
 * The shipped Agent Skills this launch should load: Pi loads a skill directory
 * directly, both Claude paths load the plugin root it sits inside. Resolved per
 * read rather than once, because the architecture-diagram bundle follows a
 * setting the user can flip while the app runs.
 * @returns The plugin roots and skill directories for the current settings.
 */
const readAgentSkillBundle = () =>
	resolveAgentSkillBundle(app, {
		architectureDiagram: readArchitectureDiagramEnabled(),
	});

/**
 * Reads the durable sub-agent marker off the chat tab bound to a session. The
 * one place that knows how to reach the database for it: the env overlay's
 * playbook, the mechanism a session opens under, and the native plan bridge all
 * ask the same question and must not disagree about the answer.
 * @param agentSessionId - The session whose tab to inspect.
 * @returns True when the session's tab is stamped as hosting a spawned sub-agent.
 */
const readSubAgentMarker = (agentSessionId: string): boolean =>
	isSessionTabMarkedSubAgent(
		databaseService.getConnection()?.database,
		agentSessionId,
	);

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
	readArchitectureDiagramEnabled,
	readCoAuthorEnabled,
	readSkillPluginDirectories: () => readAgentSkillBundle().pluginDirectories,
	readTuiHarnessesEnabled,
	/** Resolves a workspace's checkout path, or null before the database is open. */
	resolveWorkspaceCwd: (workspaceId) => {
		const database = databaseService.getConnection()?.database;
		return database ? getWorkspacePathById({ database, workspaceId }) : null;
	},
	/** Resolves the Concierge's home, or null before the root directory is known. */
	resolveConciergeCwd: () =>
		rootDirectoryService.getSnapshot()?.conciergePath ?? null,
	/** Reads the control server's URL lazily, null until the server is listening. */
	getServerUrl: () => agentControlServer?.url ?? null,
	getLanguage: resolveAppLanguage,
	/** Reads the ticket a workspace came from, for the harness playbook's issue block. */
	readLinkedIssue: (workspaceId) =>
		readWorkspaceLinkedIssue({ databaseService, workspaceId }),
	/** Reads the durable sub-agent marker so a resumed child keeps its playbook. */
	isSpawnedSubAgent: readSubAgentMarker,
});

/**
 * Base environment every agent runtime spawns under — Pi's RPC child, Claude
 * Code's SDK child, and the model lister alike. Uses the login-shell env (with
 * the user's PATH) so a packaged app launched from Finder — whose `process.env`
 * PATH is minimal — still lets the runtime find its own tools instead of exiting
 * on startup and surfacing later as an EPIPE on the first prompt write. Memoized
 * inside `localCommandService`, so repeated opens do not re-spawn a shell.
 */
const resolveAgentSpawnEnv = async (): Promise<NodeJS.ProcessEnv> =>
	(await localCommandService.getEnvironment()).env;
const piAgentAdapter = createPiCliRpcAdapter({
	/** Re-resolved per session, so a skill switched on mid-run reaches the next one. */
	baseArgs: () => [
		'--mode',
		'rpc',
		...(piControlExtensionPath ? ['-e', piControlExtensionPath] : []),
		...readAgentSkillBundle().skillDirectories.flatMap((directory) => [
			'--skill',
			directory,
		]),
	],
	onRawFrame: broadcastRawFrame,
	resolveBaseEnv: resolveAgentSpawnEnv,
});
// Claude submits plans through its own `ExitPlanMode` tool rather than the
// `ensemblr_exit_plan_mode` control op, so the bridge routes them into the same
// review path. `planSubmission` is built further down and read lazily here,
// because the plan service depends on the session service this adapter feeds.
// The per-tool approval card `approval-required` raises. One call installs both
// broadcasts, the answer channel, and the replay a reloaded window needs; the
// adapter releases the seam on every shutdown path, so nothing else is wired.
const claudeToolApproval = installClaudeToolApproval({ app, ipcMain });
const claudeAgentAdapter = createClaudeAgentAdapter({
	canUseTool: claudeToolApproval.gate,
	/**
	 * Names the Concierge home for the one session that runs in it, so the
	 * adapter gates that session's tool calls on the shared containment
	 * classifier. A session is the Concierge exactly when it opened in the home —
	 * `createRow` is the only thing that sets that cwd, and a workspace chat
	 * opens in its own checkout.
	 */
	resolveConciergeHome: ({ cwd }) => {
		const conciergePath = rootDirectoryService.getSnapshot()?.conciergePath;
		return conciergePath && path.resolve(cwd) === path.resolve(conciergePath)
			? conciergePath
			: null;
	},
	onPlanSubmitted: createClaudePlanBridge({
		/** Refuses a native plan submission from a child, as the control op does. */
		isSubAgent: (origin) =>
			resolveAgentRole(
				readSubAgentMarker(origin.sessionId),
				origin.depth,
				origin.concierge,
			) === 'subagent',
		/** Resolves a Claude session's control token back to its trusted origin. */
		resolveOrigin: (token) => agentControlOriginRegistry.resolveByToken(token),
		/** Saves the plan, posts it into the chat, and raises the review panel. */
		submitPlan: (input) => planSubmission.submit(input),
	}),
	readPluginDirectories: () => readAgentSkillBundle().pluginDirectories,
	resolveBaseEnv: resolveAgentSpawnEnv,
});
/**
 * Path to the `claude` binary a Claude session or model listing should run, or
 * `null` when neither the user's override nor PATH produced one. Ensemblr does
 * not ship the Agent SDK's per-platform runtime, so `null` means unavailable —
 * never "let the SDK pick".
 * @returns The resolved override or PATH hit, else `null`.
 */
const resolveClaudeExecutablePath = async (): Promise<string | null> =>
	(await claudeExecutableService.getSnapshot()).path || null;
const listClaudeModels = createClaudeModelLister({
	resolveBaseEnv: resolveAgentSpawnEnv,
	resolveExecutablePath: resolveClaudeExecutablePath,
});
// One catalog for both spawn routes — the renderer's open request and an
// orchestrator's delegation — so the two can never disagree about which runtime
// owns a model id, and `pi --list-models` is shelled out for once between them.
const agentModelCatalog = createAgentModelCatalog({
	listClaudeModels,
	localCommandService,
	piExecutableService,
});
const spawnModelResolver = createSpawnModelResolver({
	catalog: agentModelCatalog,
});
/**
 * Resolves the binary a non-Pi agent runtime launches, so the executable the
 * Providers page reports is the one the session actually runs. Pi's own
 * snapshot rides the open request, so it is not resolved again here.
 *
 * A runtime whose binary is missing reports an `error` snapshot rather than
 * `null`: `null` states no opinion and lets the runtime pick, which would turn
 * a missing install into an opaque spawn failure instead of a clear message.
 * @param provider - Agent runtime about to open a session.
 * @returns The executable to launch, or `null` when this runtime has no resolver.
 */
const resolveProviderExecutable = async (
	provider: AgentProviderId,
): Promise<AgentExecutableSnapshot | null> => {
	if (provider !== 'claude') {
		return null;
	}
	const path = await resolveClaudeExecutablePath();
	return { command: path ?? '', status: path ? 'ok' : 'error' };
};
// Settings → Providers reads both runtimes through one surface: Pi's probe
// adapts the existing readiness service, Claude's talks to the Agent SDK.
const agentProviderService = createAgentProviderService({
	executables: { claude: claudeExecutableService, pi: piExecutableService },
	// Pi is absent on purpose: its tools come from the harness, so it has no MCP
	// roster of its own and reports an empty one.
	mcpRosters: {
		claude: createClaudeMcpRoster({
			resolveBaseEnv: resolveAgentSpawnEnv,
			resolveExecutablePath: resolveClaudeExecutablePath,
		}),
	},
	probes: {
		claude: createClaudeReadinessProbe({
			executableService: claudeExecutableService,
			localCommandService,
			resolveBaseEnv: resolveAgentSpawnEnv,
		}),
		pi: createPiReadinessProbe({ piReadinessService }),
	},
	slashCommandCatalogs: {
		claude: createClaudeSlashCommands({
			pluginDirectories: readAgentSkillBundle().pluginDirectories,
			resolveBaseEnv: resolveAgentSpawnEnv,
			resolveExecutablePath: resolveClaudeExecutablePath,
		}),
		pi: async (cwd) =>
			resolvePiSlashCommands(
				await piExecutableService.getSnapshot(),
				cwd,
				readAgentSkillBundle().skillDirectories,
			),
	},
});
const agentClient = createAgentClient({
	adapters: { claude: claudeAgentAdapter, pi: piAgentAdapter },
});
const sessionSummaryWriter = createSessionSummaryWriter();
const renameWorkspaceService = createRenameWorkspaceService({
	databaseService,
	localCommandService,
});
const setWorkspaceBaseBranchService = createSetWorkspaceBaseBranchService({
	databaseService,
	localCommandService,
});
const continueWorkspaceBranchService = createContinueWorkspaceBranchService({
	databaseService,
	localCommandService,
});
// Gives a fresh tab a derived title to carry until the agent names it properly
// with `ensemblr_set_name`. No model runs, so a slow provider cannot leave a tab
// unlabeled; the provenance ladder makes it yield to any chosen title.
const sessionNamingQueue = createSessionNaming();
// Declared here rather than beside the rest of the plan-mode wiring below,
// because the session service reads it at open time to decide the permission
// mode a Claude child starts under.
const planModeRegistry = createPlanModeRegistry();
// Beside its Plan Mode counterpart and read at the same moment: a Claude child
// resolves the tool set it opens with from this, and the two toggles are
// mutually exclusive, so keeping the pair together is what stops one moving
// without the other.
const afkModeRegistry = createAfkModeRegistry();
/**
 * Owns the workspace architecture diagram: the stored document and the updates
 * an agent writes over it. Nothing derives one — a workspace nobody has drawn
 * has no diagram.
 */
const architectureService = createArchitectureService({
	requireDatabase: () => requireOpenDatabase(),
});
const agentSessionService = createAgentSessionService({
	databaseService,
	/** Forwards an agent session event to every window and the activity monitor. */
	eventSink: ({ event, sessionId, workspaceId }) => {
		const payload: AgentSessionEventBroadcast = {
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
				window.webContents.send(IPC_CHANNELS.agentSessionEvent, payload);
			}
		}
		agentActivityMonitor.handle({
			event: payload.event,
			sessionId,
			workspaceId,
		});
		if (event.eventType === 'shutdown') {
			agentControlService?.releaseSession(sessionId);
		}
	},
	agentClient,
	/** Reports whether the chat behind this session has Plan Mode switched on. */
	isPlanModeActive: (sessionId) => planModeRegistry.isActive(sessionId),
	isAfkModeActive: (sessionId) => afkModeRegistry.isActive(sessionId),
	/** Keeps the stop the user just asked for from notifying as a finished turn. */
	onSessionAborted: (sessionId) => agentActivityMonitor.noteUserStop(sessionId),
	/**
	 * Refreshes the chat-tab queries once a flushed summary file lands. The write
	 * settles after the close that triggered it has already answered, so the
	 * transcript list the renderer cached was taken while the file did not exist.
	 */
	onSummaryPersisted: ({ workspaceId }) =>
		broadcastToAllWindows(IPC_CHANNELS.agentControlTabsChanged, {
			workspaceId,
		}),
	/** Keeps a resumed child on `ensemblr`, whose lineage a restart forgot. */
	isSpawnedSubAgent: readSubAgentMarker,
	queueNaming: sessionNamingQueue,
	readArchitectureDiagramEnabled,
	/** Reads the delegation mechanism each new Claude Code session opens under. */
	readClaudeSubagentMode: () =>
		appSettingsService.read().providers.claudeSubagentMode,
	readTuiHarnessesEnabled,
	resolveAgentControlEnv,
	/** Reads the workspace permission mode each new agent session must honour. */
	resolvePermissionMode: () =>
		readPermissionModeFromSnapshot(settingsResolutionService.resolve()),
	resolveProviderExecutable,
	/** Renders this turn's naming upkeep for runtimes the app prompts directly. */
	resolveTurnPreamble: async (sessionId) =>
		(await agentControlService?.readTurnPreamble(sessionId)) ?? null,
	/** Live sub-agents of a session, so stopping an orchestrator stops its children. */
	resolveSpawnedChildren: (sessionId) =>
		agentControlOriginRegistry.childrenOf(sessionId),
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
const githubOwnerListService = createGithubOwnerListService({
	localCommandService,
});
const githubRemoteBranchListService = createGithubRemoteBranchListService({
	localCommandService,
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
// The terminal service, the file watcher, and the control service are all
// constructed further down this module, so each port resolves its dependency
// when a teardown actually runs rather than when this service is built.
const workspaceTeardownService = createWorkspaceTeardownService({
	forgetTerminals: (workspaceId) => {
		terminalService.forgetWorkspaceSessions(workspaceId);
	},
	killTerminal: (terminalId) => {
		terminalService.kill(terminalId);
	},
	listAgentSessionIds: (workspaceId) =>
		agentSessionService
			.listSessionsForWorkspace(workspaceId)
			.map((session) => session.id),
	listTerminalIds: (workspaceId) =>
		terminalService.readWorkspaceSessionIds(workspaceId),
	readTerminalScrollbacks: (workspaceId) =>
		terminalService.readWorkspaceScrollbacks(workspaceId),
	releaseAgentControl: (sessionId) => {
		agentControlService?.releaseSession(sessionId);
	},
	stopAgentSession: (sessionId) =>
		agentSessionService.stopSession({
			reason: WORKSPACE_REMOVED_STOP_REASON,
			sessionId,
		}),
	stopWatchingFiles: (workspaceCwd) => {
		workspaceFilesWatcher.stopWatching(workspaceCwd);
	},
	waitForTerminalExit: (terminalId, timeoutMs) =>
		terminalService.waitForExit(terminalId, timeoutMs),
});
const archiveWorkspaceService = createArchiveWorkspaceService({
	archiveLifecycleService,
	databaseService,
	localCommandService,
	rootDirectoryService,
	workspaceTeardownService,
});
const workspaceDiskSweepService = createWorkspaceDiskSweepService({
	databaseService,
	localCommandService,
	rootDirectoryService,
});
const deleteWorkspaceService = createDeleteWorkspaceService({
	databaseService,
	localCommandService,
	workspaceTeardownService,
});
const deleteRepositoryService = createDeleteRepositoryService({
	databaseService,
	localCommandService,
	rootDirectoryService,
	workspaceTeardownService,
});
const unarchiveWorkspaceService = createUnarchiveWorkspaceService({
	archiveLifecycleService,
	databaseService,
	localCommandService,
});
const deleteArchivedWorkspaceService = createDeleteArchivedWorkspaceService({
	databaseService,
	localCommandService,
	workspaceTeardownService,
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
/**
 * Hands back the open SQLite connection, throwing when there is none. The
 * services below take it as a resolver rather than a handle so a root change
 * that reopens the database does not leave them holding the old one.
 * @returns The open database.
 */
const requireOpenDatabase = (): DatabaseSync => {
	const connection = databaseService.getConnection();
	if (!connection) {
		throw new Error('The Ensemblr database is not open.');
	}
	return connection.database;
};
/**
 * Resolves the Concierge home layout under the current root, creating the root
 * record if it does not exist yet.
 * @returns The home's root, memory, and artifacts paths.
 */
const resolveConciergeHomePaths = () =>
	resolveConciergeHome(rootDirectoryService.ensure().conciergePath);
const conciergeMemoryService = createConciergeMemoryService({
	requireDatabase: requireOpenDatabase,
	resolveHome: resolveConciergeHomePaths,
});
/**
 * The Concierge: one agent above every project, running in its own corner of
 * the Ensemblr root rather than in a workspace.
 *
 * It reads across every workspace by grant rather than by enumeration — the
 * managed `workspaces/` and `repos/` roots cover every workspace that exists
 * and every one created later in the session, which a snapshot list taken at
 * open would not.
 */
const conciergeSessionService = createConciergeSessionService({
	agentClient,
	/**
	 * Forwards a Concierge transcript event to every window and to the activity
	 * monitor, which is what turns a finished turn into a desktop notification.
	 *
	 * The monitor sees only the live session's events. A child a context clear
	 * retired keeps its subscription while it writes its memories, and that pass
	 * is a whole turn: fed through, it would notify "Finished" for background
	 * work the user never asked for, and its trailing `idle` could clear the
	 * streaming session out from under the fresh one and swallow the real
	 * notification. Its rows are still broadcast — they belong in its transcript.
	 */
	eventSink: (broadcast) => {
		broadcastToAllWindows(IPC_CHANNELS.conciergeSessionEvent, broadcast);
		if (!broadcast.live) {
			return;
		}
		agentActivityMonitor.handleConcierge({
			event: broadcast.event,
			sessionId: broadcast.sessionId,
		});
	},
	/** Keeps the stop the user just asked for from notifying as a finished turn. */
	onSessionAborted: (sessionId) => agentActivityMonitor.noteUserStop(sessionId),
	requireDatabase: requireOpenDatabase,
	/** Drops the control origin a closed Concierge session held. */
	releaseControlOrigin: (sessionId) =>
		agentControlService?.releaseSession(sessionId),
	/**
	 * Everything the Concierge child needs to reach the control server: the env
	 * overlay carrying its own token, the MCP endpoint for a runtime that brings
	 * its own client, and the system prompt telling it what it is. The origin is
	 * registered as the app-level Concierge, so the server serves it the
	 * Concierge tool list — cross-workspace reads and none of the workspace
	 * write channels — rather than a workspace agent's.
	 *
	 * Pi reads the same overlay through the shipped extension and takes no
	 * endpoint; the playbook reaches it over `getSessionBrief` rather than in the
	 * system prompt, which the Pi adapter does not carry.
	 */
	resolveControlWiring: async ({ provider, sessionId }) => {
		const env = resolveAgentControlEnv({
			concierge: true,
			sessionId,
			species: provider,
			workspaceId: '',
		});
		const url = env[CONTROL_URL_ENV_KEY];
		const token = env[CONTROL_TOKEN_ENV_KEY];
		const reachesControl = Boolean(url && token);
		return {
			controlMcp:
				usesNativeControlMcp(provider) && url && token ? { token, url } : null,
			env,
			// The playbook is withheld with the endpoint, for the same reason a
			// workspace session withholds it: a Concierge that cannot reach the
			// control server holds none of the tools the playbook spends its length
			// describing, and an inventory of absent tools only sends a model hunting
			// for them.
			systemPromptAppend: [
				reachesControl
					? awarenessForAudience({
							architectureDiagram: readArchitectureDiagramEnabled(),
							delegation: 'ensemblr',
							hasChatTab: true,
							role: 'concierge',
							tuiHarnesses: readTuiHarnessesEnabled(),
						})
					: null,
				buildLanguageDirective(resolveAppLanguage()),
				// Unlike a workspace chat the Concierge gets no per-turn preamble, so
				// its credit is fixed at open: a toggle reaches the next session.
				buildCoAuthorDirective(readCoAuthorEnabled()),
			]
				.filter((block) => block !== null)
				.join('\n\n'),
		};
	},
	/**
	 * Pi's snapshot is resolved here rather than left to
	 * `resolveProviderExecutable`, which answers only for Claude because a
	 * workspace chat carries Pi's snapshot on its open request. The Concierge has
	 * no such request, so without this a Pi Concierge opened with no executable
	 * at all and failed as though Pi were missing.
	 */
	resolveExecutable: async (provider) =>
		provider === 'pi'
			? await piExecutableService.getSnapshot()
			: await resolveProviderExecutable(provider),
	resolveHome: resolveConciergeHomePaths,
	resolveReadableDirectories: () => {
		const root = rootDirectoryService.ensure();
		return [root.workspacesPath, root.repositoriesPath].filter(Boolean);
	},
	resolveSettings: () => {
		const concierge = appSettingsService.read().concierge;
		return {
			autoClearAtPercent: concierge.autoClearAtPercent,
			model: concierge.model,
			provider: concierge.provider,
			thinkingLevel: concierge.thinkingLevel,
		};
	},
	retireControlOrigin: (sessionId) =>
		agentControlService?.retireSession(sessionId),
});
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
	onAgentSessionCaptured: ({ harnessSessionId, terminalId, workspaceId }) =>
		persistTerminalAgentSessionId({
			harnessSessionId,
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
		/** Reports whether an agent session is still live before binding it to a tab. */
		agentSessionExists: ({ agentSessionId }) =>
			agentSessionService.getSession(agentSessionId) !== null,
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
const askUserQuestionCoordinator = createAskUserQuestionCoordinator({
	/**
	 * Pushes an agent's questionnaire to every window; only the owning chat
	 * renders it. Fires once per ask, so the desktop notification riding along
	 * needs no dedupe of its own — a blocked agent is the one state that wants
	 * the user more than a finished turn does.
	 */
	broadcastAsk: (payload) => {
		broadcastToAllWindows(IPC_CHANNELS.agentControlAskUserQuestion, payload);
		agentActivityMonitor.notifyQuestionRaised({
			agentSessionId: payload.agentSessionId,
			workspaceId: payload.workspaceId,
		});
	},
	/** Tells renderers to drop a questionnaire whose session ended unanswered. */
	broadcastClosed: (payload) =>
		broadcastToAllWindows(
			IPC_CHANNELS.agentControlAskUserQuestionClosed,
			payload,
		),
	/** Reports whether any window is alive to host the dialog. */
	hasRenderer: () =>
		BrowserWindow.getAllWindows().some((window) => !window.isDestroyed()),
});
ipcMain.handle(
	IPC_CHANNELS.agentControlAnswerUserQuestion,
	(_event, reply: unknown) => {
		const parsed = parseAskUserQuestionReply(reply);
		if (parsed) {
			askUserQuestionCoordinator.settle(parsed);
		}
	},
);
// Built once here rather than inside the ports factory: the review-brief
// fallback needs the same git reads the control layer's diff port does, and it
// is constructed before those ports are.
const controlWorkspaceGitService = createWorkspaceGitService({
	localCommandService,
});
const reviewLaunchCoordinator = createReviewLaunchCoordinator({
	/**
	 * Asks every window to compose the workspace's review prompt; only one that
	 * holds a live model for it answers, and none answering is the ordinary case
	 * the fallback covers.
	 */
	broadcastRequest: (payload) =>
		broadcastToAllWindows(
			IPC_CHANNELS.agentControlReviewBriefRequested,
			payload,
		),
	/** Composes the brief in main when no window answers in time. */
	composeFallback: makeReviewBriefFallback({
		databaseService,
		/** Resolves the repository's settings for its committed review preference. */
		resolveRepositorySettings: (repository) =>
			settingsResolutionService.resolve({ repository }),
		workspaceGitService: controlWorkspaceGitService,
	}),
	/** Reports whether any window is alive to compose one. */
	hasRenderer: () =>
		BrowserWindow.getAllWindows().some((window) => !window.isDestroyed()),
});
ipcMain.handle(
	IPC_CHANNELS.agentControlReviewBriefReply,
	(_event, reply: unknown) => {
		const parsed = parseReviewBriefReply(reply);
		if (parsed) {
			reviewLaunchCoordinator.settle(parsed);
		}
	},
);
const planSubmission = createPlanSubmission({
	/** Pushes a finished plan to every window; only the owning chat renders it. */
	broadcastReview: (payload) =>
		broadcastToAllWindows(IPC_CHANNELS.agentControlExitPlanMode, payload),
	/** Reports whether any window is alive to host the review panel. */
	hasRenderer: () =>
		BrowserWindow.getAllWindows().some((window) => !window.isDestroyed()),
	/** Marks the plan as under review, so the next turn is told to resubmit. */
	markSubmitted: (sessionId) => planModeRegistry.markSubmitted(sessionId),
	planFileWriter: createPlanFileWriter(),
	/** Posts the plan into the submitting chat's timeline so the user always sees it. */
	postPlanMessage: ({ sessionId, plan }) =>
		agentSessionService.appendAgentMessage({ sessionId, text: plan }),
});
// Declaring the scheme has to happen before `ready`, which module scope is; the
// handler that serves it is registered inside `whenReady` below.
registerLinearAssetScheme();
const linearAuthService = createLinearAuthService({
	configService,
	databaseService,
	getLanguage: resolveAppLanguage,
	/** Releases the asset bytes cached under an account the user just disconnected. */
	onDisconnect: (accountId) => linearAssetProxy.forgetAccount(accountId),
	/** Opens an external URL in the user's default browser. */
	openExternal: (url) => shell.openExternal(url),
	secretStoreFactory: createSecretStore,
});
// Built at module scope so the auth service above can reach it on disconnect;
// the scheme is only served once `whenReady` registers the handler below.
const linearAssetProxy = createLinearAssetProxy({
	/** Resolves one account's current Linear access token. */
	getAccessToken: (accountId) => linearAuthService.getAccessToken(accountId),
	/** Lists the accounts an asset request may name. */
	listAccountIds: async () =>
		(await linearAuthService.listAccounts()).map((account) => account.id),
});
// Built here rather than beside the other Linear wiring below because the
// agent-control ports need it: a control op reaching Linear runs long after
// startup, but the port graph is assembled in one pass.
const linearService = createLinearService({
	/** Binds a Linear client to one account's own access token. */
	clientFactory: (accountId) =>
		createLinearClient({
			/** Resolves that account's current access token from the auth service. */
			getAccessToken: () => linearAuthService.getAccessToken(accountId),
		}),
	databaseService,
	/** Lists every connected Linear account for merged reads. */
	listAccounts: () => linearAuthService.listAccounts(),
});
/**
 * The three ports only the Concierge holds. Built here rather than inside the
 * adapters because each wraps a service the composition root already owns, and
 * because the control layer adds no capability of its own — creating a workspace
 * is the same `createWorkspaceService` the "+" button calls.
 */
const conciergePorts = {
	concierge: {
		/**
		 * Hands a workspace agent's message to whichever Concierge conversation is
		 * live, as an ordinary turn so the user reads it in the panel like any
		 * other. Passed straight through rather than assembled here: resolving the
		 * session and refusing to open one are the same decision, and the service
		 * that owns the attachment is the only place both can be made at once.
		 */
		deliverMessage: (input: { prompt: string }) =>
			conciergeSessionService.deliverAgentMessage(input),
		/** What the live Concierge conversation runs on, for a child to inherit. */
		describeSession: () => conciergeSessionService.describeActiveSession(),
		/** Where the Concierge may write, which is what its tool policy checks against. */
		homePath: () => rootDirectoryService.getSnapshot()?.conciergePath ?? null,
	},
	memory: {
		/**
		 * Searches the Concierge's own memory index, bringing it in line with the
		 * files on disk first. The markdown is the source of truth and the
		 * Concierge writes it mid-session, so a recall against a stale index would
		 * miss whatever this conversation had already written down.
		 */
		recall: ({ limit, query }: { limit?: number; query: string }) => {
			conciergeMemoryService.reconcile();
			return conciergeMemoryService.recall({ limit, query });
		},
	},
	workspaceCreation: {
		/** Cuts a workspace off a project and reports the row it made. */
		createWorkspace: async ({
			baseBranch,
			name,
			projectId,
		}: {
			baseBranch?: string;
			name: string;
			projectId: string;
		}) => {
			const result = await createWorkspaceServiceWithHooks.create({
				...(baseBranch ? { baseBranch } : {}),
				name,
				repositoryId: projectId,
			});
			const workspace = result.workspace;
			if (!workspace) {
				throw new Error(
					result.diagnostics.at(0)?.message ??
						'The workspace could not be created.',
				);
			}
			return {
				branchName: workspace.branchName,
				name: workspace.name,
				path: workspace.path,
				projectId,
				workspaceId: workspace.id,
			};
		},
	},
};
agentControlService = createAgentControlService({
	guardrails: agentControlGuardrails,
	originRegistry: agentControlOriginRegistry,
	readArchitectureDiagramEnabled,
	readTuiHarnessesEnabled,
	ports: createAgentControlPorts({
		architectureService,
		augmentHarnessCommand,
		conciergePorts,
		boardStatusStore,
		reviewLaunch: reviewLaunchCoordinator.port,
		/** Broadcasts an agent-refined diagram so an open diagram tab refreshes. */
		broadcastArchitectureChanged: (payload) =>
			broadcastToAllWindows(
				IPC_CHANNELS.architectureSnapshotChanged,
				payload satisfies ArchitectureSnapshotChangedBroadcast,
			),
		/** Broadcasts an agent-reported board status update to all windows. */
		broadcastBoardStatus: (payload) =>
			broadcastToAllWindows(IPC_CHANNELS.agentControlBoardStatus, payload),
		/** Broadcasts an agent-requested view focus change to all windows. */
		broadcastFocus: (payload) =>
			broadcastToAllWindows(IPC_CHANNELS.agentControlFocusView, payload),
		/** Broadcasts an agent-driven chat-tab set change to all windows. */
		broadcastTabsChanged: (payload) =>
			broadcastToAllWindows(IPC_CHANNELS.agentControlTabsChanged, payload),
		/** Broadcasts an agent's review-comment write so the Changes panel refreshes. */
		broadcastReviewCommentsChanged: (payload) =>
			broadcastToAllWindows(
				IPC_CHANNELS.agentControlReviewCommentsChanged,
				payload,
			),
		/** Broadcasts an inherited Plan Mode state so the owning chat tab shows it. */
		broadcastPlanMode: (payload) =>
			broadcastToAllWindows(IPC_CHANNELS.agentControlPlanModeChanged, payload),
		broadcastAfkMode: (payload) =>
			broadcastToAllWindows(IPC_CHANNELS.agentControlAfkModeChanged, payload),
		appSettingsService,
		ask: askUserQuestionCoordinator.port,
		chatTabService: agentControlChatTabService,
		confirm: { confirm: confirmAgentControlAction },
		databaseService,
		renameWorkspace: renameWorkspaceService.rename,
		/** Reads the currently resolved permission mode that gates control ops. */
		getPermissionMode: () =>
			readPermissionModeFromSnapshot(settingsResolutionService.resolve()),
		getLanguage: resolveAppLanguage,
		harnessDetectionService,
		linearService,
		/** Names the connected Linear accounts for an agent that must pick one. */
		listLinearAccounts: async () =>
			(await linearAuthService.listAccounts()).map((account) => ({
				accountId: account.id,
				organization: account.organizationName,
				user: account.userName ?? account.userEmail,
				userId: account.userId,
			})),
		piExecutableService,
		spawnModelResolver,
		agentSessionService,
		// Both are stateless factories over services already constructed here, so
		// the control layer builds its own rather than reaching into the IPC
		// handlers that build theirs the same way.
		reviewService: createReviewService({ databaseService }),
		workspaceGitService: controlWorkspaceGitService,
		planMode: {
			/** Saves the finished plan, surfaces the review, and ends the turn. */
			exit: planSubmission.submit,
			/** Reports whether the calling agent session is still planning. */
			isActive: planModeRegistry.isActive,
			/** Reports whether that session's plan is already awaiting the user. */
			hasSubmittedPlan: planModeRegistry.hasSubmittedPlan,
			/** Starts a spawned child planning; narrowed to on-only on purpose. */
			activateForSpawn: (sessionId) =>
				planModeRegistry.setActive(sessionId, true),
			/** Forgets the session's Plan Mode state once it ends. */
			releaseSession: planModeRegistry.release,
		},
		afkMode: {
			/** Reports whether the user has stepped away from the calling session. */
			isActive: afkModeRegistry.isActive,
			/** Starts a spawned child unattended; narrowed to on-only on purpose. */
			activateForSpawn: afkModeRegistry.activateForSpawn,
			/** Forgets the session's AFK state once it ends. */
			releaseSession: afkModeRegistry.release,
		},
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
/**
 * Workspace creation as every caller gets it: the setup script runs. The hook
 * is fire-and-forget, so it cannot fail a create.
 */
const createWorkspaceServiceWithHooks = withSetupScriptOnCreate({
	createWorkspaceService: createWorkspaceServiceInstance,
	scriptLifecycleService,
});
const archiveWorkspaceServiceWithScript = withArchiveScriptBeforeArchive({
	archiveWorkspaceService,
	scriptLifecycleService,
});
const setupDiagnosticsService = createSetupDiagnosticsService({
	claudeExecutableService,
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

/**
 * The chrome the live window was constructed with. `titleBarStyle` is
 * construct-time, so this is the only honest answer for the renderer: reading
 * the setting again would report a preference the window predates, and the
 * shell would inset for a title bar that is not there.
 */
let activeWindowChrome = resolveWindowChrome(
	process.platform,
	DEFAULT_APP_SETTINGS.appearance.titleBar,
);

/**
 * The colour every open window should show wherever the page has not painted,
 * for the theme the app is currently in.
 * @returns The hex colour matching the renderer's canvas.
 */
function currentWindowBackgroundColor(): string {
	return resolveWindowBackgroundColor({
		prefersDark: nativeTheme.shouldUseDarkColors,
		theme: appSettingsService.read().appearance.theme,
	});
}

/**
 * Repaints every open window's backing colour after the active theme moves, so
 * a frame the renderer misses keeps showing the surface the user is looking at
 * rather than the one they switched away from.
 */
function refreshWindowBackgrounds(): void {
	const color = currentWindowBackgroundColor();
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) {
			window.setBackgroundColor(color);
		}
	}
}

/**
 * Opens the workbench window and re-announces any questionnaire still waiting on
 * the user. A renderer keeps its pending questions in memory only, and an
 * `askUserQuestion` call has no timeout to fall back on, so a window that
 * reloads would otherwise lose the card while the agent stayed blocked on it.
 *
 * Closing this window quits the app (see `window-all-closed`), so the quit
 * confirmation runs here rather than downstream: by the time `window-all-closed`
 * fires the window is destroyed, and the dialog has nothing left to attach to.
 */
function openMainWindow(): void {
	activeWindowChrome = resolveWindowChrome(
		process.platform,
		appSettingsService.read().appearance.titleBar,
	);
	const window = createMainWindow({
		backgroundColor: currentWindowBackgroundColor(),
		titleBar: activeWindowChrome.titleBar,
		windowStateStore: mainWindowStateStore,
	});
	trackWindowMaximizedState(window);
	window.webContents.on('did-finish-load', () => {
		for (const payload of askUserQuestionCoordinator.openAsks()) {
			window.webContents.send(
				IPC_CHANNELS.agentControlAskUserQuestion,
				payload,
			);
		}
	});
	window.on('close', (event) => {
		const replayClose = (): void => {
			if (!window.isDestroyed()) {
				window.close();
			}
		};
		if (quitCoordinator.handleWindowClose(replayClose)) {
			event.preventDefault();
		}
	});
}

/**
 * Reclaims workspace directories a prune or a delete believed it had removed,
 * and which a straggling writer put back afterwards.
 *
 * Fired at launch rather than awaited: the sweep walks the workspaces root and
 * unlinks whole dependency trees, and nothing about opening a window depends on
 * it. Startup is also the only moment when nothing in the app is writing into a
 * workspace, which is what makes the removal stick. Silent by design — the user
 * was already told archiving reclaims the disk — so only what it could *not*
 * sweep is worth a line in the log.
 */
async function reclaimSweptWorkspaceDisk(): Promise<void> {
	try {
		const report = await workspaceDiskSweepService.sweep();

		for (const failure of report.failures) {
			console.warn('[workspace-sweep]', failure);
		}
	} catch (error) {
		console.error(
			'[workspace-sweep] pass failed; retrying on next launch',
			error,
		);
	}
}

/**
 * Moves personal script settings into each repository's committed
 * `.ensemblr/settings.toml` (ADR 0041). Runs before any window opens so the
 * Scripts screen never reads a half-migrated repository. Fails open: the pass
 * is retried on the next launch, so nothing here is worth a windowless start.
 */
function moveRepositoryScriptsIntoCommittedConfig(): void {
	const database = databaseService.getConnection()?.database;

	if (!database) {
		return;
	}

	try {
		const migrated = migrateAllRepositoryScriptSettings(database);

		if (migrated.length > 0) {
			console.info(
				'[repository-scripts] moved personal script settings into .ensemblr/settings.toml for',
				migrated.length,
				'repositories',
			);
		}
	} catch (error) {
		console.error(
			'[repository-scripts] migration pass failed; retrying on next launch',
			error,
		);
	}
}

/**
 * Lets `safeStorage` fall back to its hardcoded key when no keyring daemon
 * answers, which is what makes ADR 0056's "a missing keyring is a warning, not
 * a crash" true rather than aspirational.
 *
 * Without it `isEncryptionAvailable()` stays false on a KWallet-less session and
 * every store and read throws, so Linear, Infisical, dictation and secret
 * workspace environment variables all hard-fail on the ADR's own target host.
 * The reduced protection is not silent: the `secret-storage` setup check reads
 * the selected backend and reports `basic_text` as a warning.
 */
function allowPlainTextSecretFallback(): void {
	if (process.platform !== 'linux') {
		return;
	}

	safeStorage.setUsePlainTextEncryption(true);
}

app.whenReady().then(() => {
	// The instance that lost the single-instance lock is already quitting; skip
	// state loading and window creation so it never touches shared userData.
	if (!hasSingleInstanceLock) {
		return;
	}

	allowPlainTextSecretFallback();

	configService.load();
	databaseService.open();
	registerLinearAssetProtocol(linearAssetProxy);
	moveRepositoryScriptsIntoCommittedConfig();
	ensureConciergeHome(rootDirectoryService.ensure().conciergePath);
	conciergeMemoryService.reconcile();
	void sharedRootAdoptionService.reconcile();
	void reclaimSweptWorkspaceDisk();
	const readAppSettings = () => appSettingsService.read();
	const menuContextStore = new MenuContextStore();
	const menuBarStore = new MenuBarStore();
	// The bar is serialized on every platform, not just where it is drawn: the
	// window's chrome is fixed at construction, so gating on the live setting
	// would leave a window that predates a change without a bar to paint.
	const rebuildMenu = () => {
		const template = installApplicationMenu(
			readAppSettings,
			menuContextStore.current,
		);
		broadcastToAllWindows(
			IPC_CHANNELS.menuBarChanged,
			menuBarStore.apply(template),
		);
	};
	rebuildMenu();
	// config.json is the source of truth; live-reload the renderer when it's
	// edited outside the app (the service suppresses echoes of its own writes).
	appSettingsService.startWatching((settings) => {
		broadcastToAllWindows(IPC_CHANNELS.appSettingsChanged, {
			settings,
		} satisfies AppSettingsChangedBroadcast);
		agentActivityMonitor.refresh();
		updateService.settingsChanged();
		refreshWindowBackgrounds();
		rebuildMenu();
	});
	// A `system` theme follows the OS, and the backing colour has to follow it
	// too — otherwise the window keeps flashing the polarity the user left.
	nativeTheme.on('updated', refreshWindowBackgrounds);
	// Live-reload the non-App config sections (linear, security, managed,
	// environment, repositoryDefaults, repositoryRules) so external config.json
	// edits take effect without a restart.
	configService.startWatching((snapshot) => {
		broadcastToAllWindows(IPC_CHANNELS.configChanged, {
			snapshot,
		} satisfies ConfigChangedBroadcast);
	});
	// Names a planning workspace from its first prompt, so the board stops showing
	// a generated placeholder for the whole interview. Provisional by design: it
	// leaves both naming gates open, so the agent's own `ensemblr_set_branch_name`
	// still lands as a first naming rather than being refused as a second.
	const provisionalNamingQueue = createProvisionalWorkspaceNaming({
		databaseService,
		namingEnabled: () => appSettingsService.read().git.renameWorkspaceOnBranch,
		/** Announces a landed guess on both channels the agent's own rename uses. */
		onRenamed: ({ sessionId, workspaceId }) => {
			// The tabs broadcast alone refreshes the chat-tab queries and nothing
			// else; the sidebar reads the workspace name from a cached navigation
			// query that only this timeline event invalidates, so dropping it would
			// move the row in SQLite and leave the board on the placeholder.
			agentSessionService.appendWorkspaceRenamed(sessionId);
			broadcastToAllWindows(IPC_CHANNELS.agentControlTabsChanged, {
				workspaceId,
			});
		},
		renameWorkspace: renameWorkspaceService.rename,
	});
	ipcHandlersHandle = registerIpcHandlers({
		activeChatStore,
		agentProviderService,
		appSettingsService,
		architectureService,
		archiveWorkspaceService: archiveWorkspaceServiceWithScript,
		augmentHarnessCommand,
		conciergeSessionService,
		resolveConciergeHome: resolveConciergeHomePaths,
		configService,
		continueWorkspaceBranchService,
		createWorkspaceService: createWorkspaceServiceWithHooks,
		databaseService,
		deleteArchivedWorkspaceService,
		deleteRepositoryService,
		deleteWorkspaceService,
		dictationService,
		environmentVariablesService,
		getInfisicalService,
		githubCloneService,
		githubOwnerListService,
		githubRemoteBranchListService,
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
		agentModelCatalog,
		agentSessionService,
		afkModeRegistry,
		planModeRegistry,
		provisionalNamingQueue,
		quickStartProjectService,
		renameWorkspaceService,
		// The in-app write is echo-suppressed and so never reaches the watcher
		// above; without this rebuild the menu keeps the previous language until
		// the next restart.
		onAppSettingsUpdated: () => {
			agentActivityMonitor.refresh();
			updateService.settingsChanged();
			refreshWindowBackgrounds();
			rebuildMenu();
		},
		menuBarStore,
		menuContextStore,
		rebuildMenu,
		readWindowChrome: () => activeWindowChrome,
		repositoryConfigService,
		requestRelaunch: () => quitCoordinator.requestRelaunch(),
		rootDirectoryService,
		scriptLifecycleService,
		setWorkspaceBaseBranchService,
		setupDiagnosticsService,
		settingsResolutionService,
		sharedRootAdoptionService,
		terminalService,
		unarchiveWorkspaceService,
		updateService,
		workspaceFilesWatcher,
	});
	terminalService.recoverStaleSessions();
	// Behind the single-instance guard, not at module scope: a doomed second
	// instance runs the whole module before `app.exit(0)`, and arming Squirrel's
	// listeners and the check timer there would be a side effect the
	// construction-only rule above exists to keep out.
	updateService.start();
	openMainWindow();
});

const quitGuard = createQuitGuard({
	/** Shows the native quit confirmation, parented to the focused window. */
	confirm: async (request) => {
		const parentWindow = BrowserWindow.getFocusedWindow();
		const { response } = parentWindow
			? await dialog.showMessageBox(parentWindow, {
					type: 'question',
					...request,
				})
			: await dialog.showMessageBox({ type: 'question', ...request });
		return response;
	},
	getLanguage: resolveAppLanguage,
	/** Whether a window survives to host the dialog. */
	hasWindow: () =>
		BrowserWindow.getAllWindows().some((window) => !window.isDestroyed()),
	/** Every agent-harness terminal, across all workspaces. */
	listAgentTerminals: () => terminalService.listByKind('agent'),
	listRunningSessions: agentActivityMonitor.listRunning,
	/** Workspace id to display name, read once per prompt. */
	listWorkspaceNames: async () => {
		const { entries } = await listAllWorkspacesService.list();
		return new Map(entries.map((entry) => [entry.id, entry.name]));
	},
	/** The chat's own title, or null before the database is open or a name lands. */
	readChatTitle: (sessionId) => {
		const database = databaseService.getConnection()?.database;
		if (!database) {
			return null;
		}
		return (
			getChatTabByAgentSessionId({ agentSessionId: sessionId, database })
				?.title ?? null
		);
	},
});

/**
 * Terminates the Pi RPC children and the terminal PTY children, then re-issues
 * the quit. Both shutdowns resolve only once each child has actually exited,
 * which keeps orphaned `pi --mode rpc` processes from surviving app quit and
 * keeps a dying PTY from reporting its exit into a half-destroyed JS environment
 * — where node-pty's native callback aborts the process instead of surfacing.
 * `before-quit` is synchronous, so the real quit is deferred until the async
 * shutdown settles; a bounded race guarantees a wedged child can never block
 * quit indefinitely.
 *
 * The approval gate fails closed first, before that grace period: a Claude
 * session in approval-required mode can still issue tool calls while the race
 * plays out, and by then no window is left to put them to the user.
 *
 * `quitAndInstall` is what ends a restart-to-install, and it belongs here rather
 * than at the gesture: it issues its own quit, so calling it before the children
 * are down would relaunch over a still-running Pi tree.
 * @param exit - Whether this quit ends by exiting or by relaunching into a staged update
 */
function beginAgentShutdown(exit: QuitExit): void {
	claudeToolApproval.shutdown();
	void (async () => {
		await Promise.race([
			Promise.allSettled([agentClient.shutdown(), terminalService.shutdown()]),
			new Promise((resolve) => setTimeout(resolve, 3000)),
		]);
		if (exit === 'install-update') {
			autoUpdater.quitAndInstall();
			return;
		}
		if (exit === 'relaunch') {
			app.relaunch();
		}
		app.quit();
	})();
}

const quitCoordinator = createQuitCoordinator({
	beginAgentShutdown,
	confirmQuit: quitGuard.confirmQuit,
	quit: () => app.quit(),
});

const updateService = createAppUpdateService({
	broadcast: (snapshot) =>
		broadcastToAllWindows(IPC_CHANNELS.updateStatusChanged, {
			snapshot,
		} satisfies UpdateStatusChangedBroadcast),
	isEnabled: () => appSettingsService.read().general.automaticUpdates,
	requestInstall: quitCoordinator.requestInstallUpdate,
});

// Quitting kills every in-flight turn, so nothing is torn down until the guard
// has had its say. Both phases defer the real quit and re-issue it themselves,
// so every gesture — ⌘Q, the menu, the Dock, the window's own close button —
// walks the same two steps.
app.on('before-quit', (event) => {
	if (quitCoordinator.handleBeforeQuit()) {
		event.preventDefault();
	}
});

app.on('will-quit', () => {
	appSettingsService.stop();
	configService.stop();
	updateService.stop();
	agentActivityMonitor.dispose();
	void agentControlServer?.close();
	// Backstop for a quit that skipped the `before-quit` grace: the synchronous
	// half (flush, detach, SIGHUP) still runs before this returns, and a shutdown
	// already in flight is reused rather than restarted.
	void terminalService.shutdown();
	ipcHandlersHandle?.dispose();
	workspaceFilesWatcher.stopAll();
	databaseService.close();
});

// Quit once the last window closes on every platform, macOS included. Ensemblr is
// a single-window workbench, not a menu-bar resident, so keeping the process (and
// its Pi RPC children) alive with no windows just wastes resources and leaves a
// stray Dock tile. `before-quit` still drives the graceful Pi shutdown.
//
// Losing the last window is itself the point of no return for the approval gate:
// from here nobody can answer a prompt, so it denies rather than waits.
app.on('window-all-closed', () => {
	claudeToolApproval.shutdown();
	app.quit();
});

app.on('activate', () => {
	if (BrowserWindow.getAllWindows().length === 0) {
		openMainWindow();
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
	openMainWindow();
});
