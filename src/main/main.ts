import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { parseAskUserQuestionReply } from '../shared/agent-control.ts';
import type { AgentProviderId } from '../shared/agent-provider.ts';
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
import type { ConfigChangedBroadcast } from '../shared/ipc/contracts/health';
import type {
	TerminalLifecycleBroadcast,
	TerminalOutputBroadcast,
} from '../shared/ipc/contracts/terminal';
import type { WorkspaceFilesChangedBroadcast } from '../shared/ipc/contracts/workspace-files';
import { scrollbackMbToBytes } from '../shared/terminal.ts';
import {
	type AgentControlService,
	type BoardStatusStore,
	type ControlServer,
	createAgentControlIntegration,
	createAgentControlPorts,
	createAgentControlService,
	createAskUserQuestionCoordinator,
	createBoardStatusStore,
	createGuardrails,
	createOriginRegistry,
	isSessionTabMarkedSubAgent,
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
} from './agent-runtime';
import { ActiveChatStore } from './agent-runtime/active-chat-store';
import { createAgentActivityMonitor } from './agent-runtime/agent-activity-monitor';
import { createAgentSessionService } from './agent-runtime/agent-session-service';
import {
	electronIsAppFocused,
	electronNotify,
	electronPowerControls,
} from './agent-runtime/electron-activity-bindings';
import { readMacosBattery } from './agent-runtime/macos-battery';
import { createProvisionalWorkspaceNaming } from './agent-runtime/naming/provisional-workspace-naming';
import { createSessionNaming } from './agent-runtime/naming/session-naming';
import { resolveNotificationTarget } from './agent-runtime/notification-target';
import { createSessionSummaryWriter } from './agent-runtime/session-summary-writer';
import { createHarnessDetectionService } from './agents';
import { createMainWindow } from './app/main-window';
import { createQuitCoordinator } from './app/quit-coordinator';
import { createQuitGuard } from './app/quit-guard';
import { createMainWindowStateStore } from './app/window-state';
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
import { type IpcHandlersHandle, registerIpcHandlers } from './ipc';
import { readPermissionModeFromSnapshot } from './ipc/permission-gate.ts';
import {
	createLinearAuthService,
	createLinearClient,
	createLinearService,
} from './linear';
import { installApplicationMenu, MenuContextStore } from './menu';
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
	createArchiveRepositoryService,
	createArchiveWorkspaceService,
	createContinueWorkspaceBranchService,
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
	createSetWorkspaceBaseBranchService,
	createSharedRootAdoptionService,
	createUnarchiveWorkspaceService,
	createWorkspaceService,
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
import { createMacosKeychainSecretStore } from './secrets';
import { createSetupDiagnosticsService } from './setup';
import {
	createEnsemblrDatabaseService,
	resolveDefaultDatabasePath,
} from './storage';
import { getChatTabByAgentSessionId } from './storage/repositories/chat-tab-repository.ts';
import { getWorkspacePathById } from './storage/repositories/workspace-repository.ts';
import { createTerminalService } from './terminal';
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
// userData across dogfooding workspaces, so a lock there would kill the second
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
const databaseService = createEnsemblrDatabaseService(
	isDev ? { databasePath: devDatabasePath } : {},
);
// The chat the renderer last reported as on screen, so a desktop notification is
// suppressed for that chat alone rather than for the whole app.
const activeChatStore = new ActiveChatStore();
// Drives the caffeinate power-blocker + "agent finished" desktop notifications,
// gated live by the General settings in config.json.
const agentActivityMonitor = createAgentActivityMonitor({
	isAppFocused: electronIsAppFocused,
	/** Reports whether the user is looking at exactly this chat right now. */
	isChatOnScreen: (workspaceId, agentSessionId) =>
		activeChatStore.isOnScreen(workspaceId, agentSessionId),
	notify: electronNotify,
	powerControls: electronPowerControls,
	readBattery: readMacosBattery,
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
const environmentVariablesService = createEnvironmentVariablesService({
	configService,
	databaseService,
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
	/** Resolves a workspace's checkout path, or null before the database is open. */
	resolveWorkspaceCwd: (workspaceId) => {
		const database = databaseService.getConnection()?.database;
		return database ? getWorkspacePathById({ database, workspaceId }) : null;
	},
	/** Reads the control server's URL lazily, null until the server is listening. */
	getServerUrl: () => agentControlServer?.url ?? null,
	getLanguage: resolveAppLanguage,
	/** Reads the durable sub-agent marker so a resumed child keeps its playbook. */
	isSpawnedSubAgent: (agentSessionId) =>
		isSessionTabMarkedSubAgent(
			databaseService.getConnection()?.database,
			agentSessionId,
		),
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
	baseArgs: piControlExtensionPath
		? ['--mode', 'rpc', '-e', piControlExtensionPath]
		: undefined,
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
	onPlanSubmitted: createClaudePlanBridge({
		/** Resolves a Claude session's control token back to its trusted origin. */
		resolveOrigin: (token) => agentControlOriginRegistry.resolveByToken(token),
		/** Saves the plan, posts it into the chat, and raises the review panel. */
		submitPlan: (input) => planSubmission.submit(input),
	}),
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
			resolveBaseEnv: resolveAgentSpawnEnv,
			resolveExecutablePath: resolveClaudeExecutablePath,
		}),
		pi: async (cwd) =>
			resolvePiSlashCommands(await piExecutableService.getSnapshot(), cwd),
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
	/** Keeps the stop the user just asked for from notifying as a finished turn. */
	onSessionAborted: (sessionId) => agentActivityMonitor.noteUserStop(sessionId),
	queueNaming: sessionNamingQueue,
	/** Reads the delegation mechanism each new Claude Code session opens under. */
	readClaudeSubagentMode: () =>
		appSettingsService.read().providers.claudeSubagentMode,
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
const planSubmission = createPlanSubmission({
	/** Pushes a finished plan to every window; only the owning chat renders it. */
	broadcastReview: (payload) =>
		broadcastToAllWindows(IPC_CHANNELS.agentControlExitPlanMode, payload),
	/** Reports whether any window is alive to host the review panel. */
	hasRenderer: () =>
		BrowserWindow.getAllWindows().some((window) => !window.isDestroyed()),
	planFileWriter: createPlanFileWriter(),
	/** Posts the plan into the submitting chat's timeline so the user always sees it. */
	postPlanMessage: ({ sessionId, plan }) =>
		agentSessionService.appendAgentMessage({ sessionId, text: plan }),
});
const linearAuthService = createLinearAuthService({
	configService,
	databaseService,
	/** Opens an external URL in the user's default browser. */
	openExternal: (url) => shell.openExternal(url),
	secretStoreFactory: createSecretStore,
});
// Built here rather than beside the other Linear wiring below because the
// agent-control ports need it: a control op reaching Linear runs long after
// startup, but the port graph is assembled in one pass.
const linearService = createLinearService({
	client: createLinearClient({
		/** Resolves the current Linear access token from the auth service. */
		getAccessToken: () => linearAuthService.getAccessToken(),
	}),
	databaseService,
});
agentControlService = createAgentControlService({
	guardrails: agentControlGuardrails,
	originRegistry: agentControlOriginRegistry,
	ports: createAgentControlPorts({
		augmentHarnessCommand,
		boardStatusStore,
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
		piExecutableService,
		spawnModelResolver,
		agentSessionService,
		// Both are stateless factories over services already constructed here, so
		// the control layer builds its own rather than reaching into the IPC
		// handlers that build theirs the same way.
		reviewService: createReviewService({ databaseService }),
		workspaceGitService: createWorkspaceGitService({ localCommandService }),
		planMode: {
			/** Saves the finished plan, surfaces the review, and ends the turn. */
			exit: planSubmission.submit,
			/** Reports whether the calling agent session is still planning. */
			isActive: planModeRegistry.isActive,
			/** Starts a spawned child planning; narrowed to on-only on purpose. */
			activateForSpawn: (sessionId) =>
				planModeRegistry.setActive(sessionId, true),
			/** Forgets the session's Plan Mode state once it ends. */
			releaseSession: planModeRegistry.release,
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
const createWorkspaceServiceWithSetup = withSetupScriptOnCreate({
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
	const window = createMainWindow({ windowStateStore: mainWindowStateStore });
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

app.whenReady().then(() => {
	// The instance that lost the single-instance lock is already quitting; skip
	// state loading and window creation so it never touches shared userData.
	if (!hasSingleInstanceLock) {
		return;
	}

	configService.load();
	databaseService.open();
	moveRepositoryScriptsIntoCommittedConfig();
	rootDirectoryService.ensure();
	void sharedRootAdoptionService.reconcile();
	const readAppSettings = () => appSettingsService.read();
	const menuContextStore = new MenuContextStore();
	const rebuildMenu = () => {
		installApplicationMenu(readAppSettings, menuContextStore.current);
	};
	rebuildMenu();
	// config.json is the source of truth; live-reload the renderer when it's
	// edited outside the app (the service suppresses echoes of its own writes).
	appSettingsService.startWatching((settings) => {
		broadcastToAllWindows(IPC_CHANNELS.appSettingsChanged, {
			settings,
		} satisfies AppSettingsChangedBroadcast);
		agentActivityMonitor.refresh();
		rebuildMenu();
	});
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
		archiveRepositoryService,
		archiveWorkspaceService: archiveWorkspaceServiceWithScript,
		augmentHarnessCommand,
		configService,
		continueWorkspaceBranchService,
		createWorkspaceService: createWorkspaceServiceWithSetup,
		databaseService,
		deleteArchivedWorkspaceService,
		deleteRepositoryService,
		deleteWorkspaceService,
		dictationService,
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
		agentModelCatalog,
		agentSessionService,
		planModeRegistry,
		provisionalNamingQueue,
		quickStartProjectService,
		renameWorkspaceService,
		// The in-app write is echo-suppressed and so never reaches the watcher
		// above; without this rebuild the menu keeps the previous language until
		// the next restart.
		onAppSettingsUpdated: () => {
			agentActivityMonitor.refresh();
			rebuildMenu();
		},
		menuContextStore,
		rebuildMenu,
		repositoryConfigService,
		rootDirectoryService,
		scriptLifecycleService,
		setWorkspaceBaseBranchService,
		setupDiagnosticsService,
		settingsResolutionService,
		sharedRootAdoptionService,
		terminalService,
		unarchiveWorkspaceService,
		workspaceFilesWatcher,
	});
	terminalService.recoverStaleSessions();
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
 */
function beginAgentShutdown(): void {
	claudeToolApproval.shutdown();
	void (async () => {
		await Promise.race([
			Promise.allSettled([agentClient.shutdown(), terminalService.shutdown()]),
			new Promise((resolve) => setTimeout(resolve, 3000)),
		]);
		app.quit();
	})();
}

const quitCoordinator = createQuitCoordinator({
	beginAgentShutdown,
	confirmQuit: quitGuard.confirmQuit,
	quit: () => app.quit(),
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
