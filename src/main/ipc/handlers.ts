import type { AppSettings } from '../../shared/config.ts';
import type { AppLanguage } from '../../shared/i18n';
import type { WindowChromeSnapshot } from '../../shared/window-chrome';
import type { AfkModeRegistry } from '../afk-mode';
import type {
	AgentModelCatalogService,
	AgentProviderService,
} from '../agent-providers';
import type { AgentSessionService } from '../agent-runtime';
import type { ActiveChatStore } from '../agent-runtime/active-chat-store.ts';
import type { QueueProvisionalNamingPort } from '../agent-runtime/naming/provisional-workspace-naming';
import type { HarnessDetectionService } from '../agents/index.ts';
import type { ArchitectureService } from '../architecture/index.ts';
import { createChatTabService } from '../chat-tabs/index.ts';
import type { LocalCommandService } from '../commands/local-command';
import type { ConciergeHome, ConciergeSessionService } from '../concierge';
import type {
	AppSettingsService,
	EnsemblrConfigResolutionService,
	EnsemblrConfigService,
	RepositoryConfigService,
	SettingsPublicationService,
} from '../config';
import type { DictationService } from '../dictation';
import type { EnvironmentVariablesService } from '../environment';
import {
	createGithubService,
	createWorkspacePrStatusSweeper,
	type GithubService,
	listSweepableWorkspaces,
} from '../github/index.ts';
import type { InfisicalService } from '../infisical';
import type { LinearAuthService, LinearService } from '../linear';
import { createLinkedDirectoryService } from '../linked-directories/index.ts';
import type { MenuBarStore, MenuContextStore } from '../menu';
import type { OpenTargetService } from '../open-target';
import type { PiExecutableService } from '../pi-runtime';
import type { PlanModeRegistry } from '../plan-mode';
import type {
	ArchiveWorkspaceService,
	ContinueWorkspaceBranchService,
	CreateWorkspaceService,
	DeleteArchivedWorkspaceService,
	DeleteRepositoryService,
	DeleteWorkspaceService,
	GithubCloneService,
	GithubOwnerListService,
	GithubRemoteBranchListService,
	GithubRepositoryListService,
	ListAllWorkspacesService,
	ListArchivedWorkspacesService,
	LocalRepositoryRegistrationService,
	QuickStartProjectService,
	RenameWorkspaceService,
	SetWorkspaceBaseBranchService,
	SharedRootAdoptionService,
	UnarchiveWorkspaceService,
} from '../repository';
import { createRepositorySourcesService } from '../repository/repository-sources-service';
import { createReviewService } from '../review';
import type { EnsemblrRootDirectoryService } from '../root';
import type { ScriptLifecycleService } from '../scripts';
import type { SetupDiagnosticsService } from '../setup';
import type { EnsemblrDatabaseService } from '../storage';
import { getAgentSessionById } from '../storage/repositories/agent-session-repository';
import type { TerminalService } from '../terminal';
import type { UpdateService } from '../updates';
import type {
	ListWorkspaceFilesService,
	WorkspaceFilesWatcher,
} from '../workspace-files';
import { createWorkspaceGitService } from '../workspace-git';
import { registerActiveChatHandlers } from './handlers/active-chat';
import { registerAgentProviderHandlers } from './handlers/agent-provider';
import { registerAgentSessionHandlers } from './handlers/agent-session';
import { registerAgentHandlers } from './handlers/agents';
import { registerAppSettingsHandlers } from './handlers/app-settings';
import { registerArchitectureHandlers } from './handlers/architecture';
import { registerChatTabHandlers } from './handlers/chat-tab';
import { registerCheckpointHandlers } from './handlers/checkpoint';
import { registerCloneHandlers } from './handlers/clone';
import { registerConciergeHandlers } from './handlers/concierge';
import { registerDictationHandlers } from './handlers/dictation';
import { registerEnvironmentHandlers } from './handlers/environment';
import { registerGithubHandlers } from './handlers/github';
import { registerHealthHandlers } from './handlers/health';
import { registerInfisicalHandlers } from './handlers/infisical';
import { registerLinearHandlers } from './handlers/linear';
import { registerLinkedDirectoryHandlers } from './handlers/linked-directories';
import { registerMenuHandlers } from './handlers/menu';
import { registerNavigationHandlers } from './handlers/navigation';
import { registerOpenTargetHandlers } from './handlers/open-target';
import { registerRepositoryHandlers } from './handlers/repository';
import { registerRepositoryConfigHandlers } from './handlers/repository-config';
import { registerRepositorySettingsHandlers } from './handlers/repository-settings';
import { registerRepositorySourcesHandlers } from './handlers/repository-sources';
import { registerReviewHandlers } from './handlers/review';
import { registerRootHandlers } from './handlers/root';
import { registerSecretsHandlers } from './handlers/secrets';
import { registerSettingsHandlers } from './handlers/settings';
import { registerSettingsPublicationHandlers } from './handlers/settings-publication';
import { registerSetupHandlers } from './handlers/setup';
import { registerShellSnapshotHandlers } from './handlers/shell-snapshot';
import { registerTerminalHandlers } from './handlers/terminal';
import { registerTextEditingHandlers } from './handlers/text-editing';
import { registerUpdateHandlers } from './handlers/update';
import { registerWindowHandlers } from './handlers/window';
import { registerWorkspaceFilesHandlers } from './handlers/workspace-files';
import { registerWorkspaceGitHandlers } from './handlers/workspace-git';
import { registerWorkspaceScriptHandlers } from './handlers/workspace-scripts';
import { installPermissionGate } from './permission-gate.ts';
import { createPermissionModeResolver } from './permission-mode-resolver.ts';

/**
 * How long the PR-status sweeper waits before its first pass. Registration runs
 * before the window exists, and the first tick sweeps every workspace at once,
 * so arming it immediately spends `gh` spawns and network against renderer
 * startup for nothing the sidebar reads yet.
 */
const PR_SWEEP_START_DELAY_MS = 15_000;

/** Dependency bundle wired into the renderer-facing IPC handlers. */
interface RegisterIpcHandlersOptions {
	agentProviderService: AgentProviderService;
	appSettingsService: AppSettingsService;
	architectureService: ArchitectureService;
	archiveWorkspaceService: ArchiveWorkspaceService;
	conciergeSessionService: ConciergeSessionService;
	/** Re-read per call, so a root the user moved resolves to the home that is there now. */
	resolveConciergeHome: () => ConciergeHome;
	configService: EnsemblrConfigService;
	continueWorkspaceBranchService: ContinueWorkspaceBranchService;
	createWorkspaceService: CreateWorkspaceService;
	augmentHarnessCommand?: (
		command: string,
		harnessId: string,
		workspaceId: string,
	) => string;
	databaseService: EnsemblrDatabaseService;
	deleteArchivedWorkspaceService: DeleteArchivedWorkspaceService;
	deleteRepositoryService: DeleteRepositoryService;
	deleteWorkspaceService: DeleteWorkspaceService;
	dictationService: DictationService;
	environmentVariablesService: EnvironmentVariablesService;
	/** Resolves the Infisical service, which is rebuilt when the database connection changes. */
	getInfisicalService: () => InfisicalService | null;
	/** Reads the app's resolved UI language for native dialogs. */
	getLanguage: () => AppLanguage;
	githubCloneService: GithubCloneService;
	githubOwnerListService: GithubOwnerListService;
	githubRemoteBranchListService: GithubRemoteBranchListService;
	githubRepositoryListService: GithubRepositoryListService;
	harnessDetectionService: HarnessDetectionService;
	linearAuthService: LinearAuthService;
	linearService: LinearService;
	listAllWorkspacesService: ListAllWorkspacesService;
	listArchivedWorkspacesService: ListArchivedWorkspacesService;
	listWorkspaceFilesService: ListWorkspaceFilesService;
	localCommandService: LocalCommandService;
	localRepositoryRegistrationService: LocalRepositoryRegistrationService;
	/** Holds the chat the renderer reports as on screen, read by the desktop notifier. */
	activeChatStore: ActiveChatStore;
	/** Holds the menu context the renderer reports, shared with the menu rebuild. */
	menuContextStore: MenuContextStore;
	/** Holds the serialized menu bar the renderer draws for itself. */
	menuBarStore: MenuBarStore;
	/** Reinstalls the native application menu from the current settings and menu context. */
	rebuildMenu: () => void;
	/** Fired after an in-app App-settings write so renderer and side-effects refresh. */
	onAppSettingsUpdated?: (settings: AppSettings) => void;
	openTargetService: OpenTargetService;
	piExecutableService: PiExecutableService;
	/** Merged per-runtime model catalog, shared with the agent-control spawn path. */
	agentModelCatalog: AgentModelCatalogService;
	agentSessionService: AgentSessionService;
	planModeRegistry: PlanModeRegistry;
	/** Mirror of the composer's per-chat AFK toggle, Plan Mode's opposite number. */
	afkModeRegistry: AfkModeRegistry;
	/** Names a planning workspace from its first prompt, ahead of the agent. */
	provisionalNamingQueue: QueueProvisionalNamingPort;
	quickStartProjectService: QuickStartProjectService;
	renameWorkspaceService: RenameWorkspaceService;
	repositoryConfigService: RepositoryConfigService;
	/** The chrome the running window was constructed with, not the current setting. */
	readWindowChrome: () => WindowChromeSnapshot;
	/** Quits and starts this build again, draining running agents on the way out. */
	requestRelaunch: () => void;
	rootDirectoryService: EnsemblrRootDirectoryService;
	scriptLifecycleService: ScriptLifecycleService;
	setWorkspaceBaseBranchService: SetWorkspaceBaseBranchService;
	sharedRootAdoptionService: SharedRootAdoptionService;
	setupDiagnosticsService: SetupDiagnosticsService;
	settingsPublicationService: SettingsPublicationService;
	settingsResolutionService: EnsemblrConfigResolutionService;
	terminalService: TerminalService;
	unarchiveWorkspaceService: UnarchiveWorkspaceService;
	updateService: UpdateService;
	workspaceFilesWatcher: WorkspaceFilesWatcher;
}

/** Teardown handle for the lifecycle-owning work `registerIpcHandlers` starts. */
export interface IpcHandlersHandle {
	/** Stops background workers (e.g. the PR-status sweeper) on app quit. */
	dispose: () => void;
}

/**
 * Composition root for every renderer-facing `ipcMain` handler. Each domain
 * group lives in its own `handlers/<domain>.ts` file and receives only the
 * services it needs.
 * @param options - Service dependencies the handlers delegate to.
 * @returns A handle that tears down background workers on app quit.
 */
export function registerIpcHandlers({
	agentProviderService,
	appSettingsService,
	architectureService,
	archiveWorkspaceService,
	augmentHarnessCommand,
	configService,
	continueWorkspaceBranchService,
	createWorkspaceService,
	databaseService,
	deleteArchivedWorkspaceService,
	deleteRepositoryService,
	deleteWorkspaceService,
	dictationService,
	environmentVariablesService,
	getInfisicalService,
	getLanguage,
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
	localRepositoryRegistrationService,
	menuBarStore,
	menuContextStore,
	onAppSettingsUpdated,
	activeChatStore,
	openTargetService,
	rebuildMenu,
	piExecutableService,
	agentModelCatalog,
	agentSessionService,
	conciergeSessionService,
	resolveConciergeHome,
	afkModeRegistry,
	planModeRegistry,
	provisionalNamingQueue,
	quickStartProjectService,
	readWindowChrome,
	renameWorkspaceService,
	repositoryConfigService,
	requestRelaunch,
	rootDirectoryService,
	scriptLifecycleService,
	setWorkspaceBaseBranchService,
	setupDiagnosticsService,
	settingsPublicationService,
	settingsResolutionService,
	sharedRootAdoptionService,
	terminalService,
	updateService,
	unarchiveWorkspaceService,
	workspaceFilesWatcher,
}: RegisterIpcHandlersOptions): IpcHandlersHandle {
	const resolvePermissionMode = createPermissionModeResolver({
		databaseService,
		resolveSettings: (request) => settingsResolutionService.resolve(request),
	});
	const restorePermissionGate = installPermissionGate({
		databaseService,
		getLanguage,
		resolveMode: resolvePermissionMode,
	});

	/**
	 * Registers every handler group while the permission gate is intercepting
	 * `ipcMain.handle`, and restores the original before returning so nothing
	 * registered later is silently gated by a table it was never checked against.
	 * @returns The GitHub service the PR sweeper outlives registration with.
	 */
	const registerGatedHandlerGroups = (): GithubService => {
		try {
			registerWindowHandlers({ requestRelaunch });
			registerTextEditingHandlers();
			registerMenuHandlers({ menuBarStore, menuContextStore, rebuildMenu });
			registerActiveChatHandlers({ activeChatStore });
			registerAppSettingsHandlers({ appSettingsService, onAppSettingsUpdated });
			registerDictationHandlers({ dictationService });
			registerSecretsHandlers({ databaseService });
			registerEnvironmentHandlers({ environmentVariablesService });
			registerInfisicalHandlers({ getInfisicalService });
			registerHealthHandlers({ configService, databaseService });
			registerShellSnapshotHandlers({
				appSettingsService,
				configService,
				databaseService,
				openTargetService,
				readWindowChrome,
			});
			registerNavigationHandlers({ databaseService });
			registerSettingsHandlers({ settingsResolutionService });
			registerRootHandlers({
				rootDirectoryService,
				sharedRootAdoptionService,
			});
			registerRepositoryConfigHandlers({
				databaseService,
				repositoryConfigService,
			});
			registerRepositoryHandlers({
				archiveWorkspaceService,
				continueWorkspaceBranchService,
				createWorkspaceService,
				deleteArchivedWorkspaceService,
				deleteRepositoryService,
				deleteWorkspaceService,
				githubOwnerListService,
				getLanguage,
				listAllWorkspacesService,
				listArchivedWorkspacesService,
				localRepositoryRegistrationService,
				quickStartProjectService,
				renameWorkspaceService,
				setWorkspaceBaseBranchService,
				sharedRootAdoptionService,
				unarchiveWorkspaceService,
			});
			registerCloneHandlers({
				githubCloneService,
				githubRemoteBranchListService,
				githubRepositoryListService,
			});
			registerAgentProviderHandlers({
				agentProviderService,
				openTargetService,
			});
			registerAgentSessionHandlers({
				agentModelCatalog,
				agentSessionService,
				piExecutableService,
				afkModeRegistry,
				planModeRegistry,
				provisionalNamingQueue,
			});
			registerConciergeHandlers({
				conciergeSessionService,
				resolveConciergeHome,
			});
			registerChatTabHandlers({
				chatTabService: createChatTabService({
					databaseService,
					lookups: {
						agentSessionExists: ({ agentSessionId }) => {
							const database = databaseService.getConnection()?.database;
							if (!database) {
								return false;
							}
							return (
								getAgentSessionById({ database, id: agentSessionId }) !== null
							);
						},
					},
				}),
				flushSummaryForChatTab: agentSessionService.flushSummaryForChatTab,
			});
			registerArchitectureHandlers({ architectureService });
			registerCheckpointHandlers({ databaseService });
			registerReviewHandlers({
				reviewService: createReviewService({ databaseService }),
			});
			registerLinearHandlers({ linearAuthService, linearService });
			registerLinkedDirectoryHandlers({
				linkedDirectoryService: createLinkedDirectoryService({
					databaseService,
				}),
			});
			registerOpenTargetHandlers({
				appSettingsService,
				databaseService,
				openTargetService,
			});
			registerSetupHandlers({ setupDiagnosticsService });
			registerTerminalHandlers({ terminalService });
			registerUpdateHandlers({ updateService });
			registerAgentHandlers({
				augmentHarnessCommand,
				databaseService,
				harnessDetectionService,
				readTuiHarnessesEnabled: () =>
					appSettingsService.read().experimental.tuiHarnesses,
				terminalService,
			});
			registerWorkspaceScriptHandlers({
				databaseService,
				scriptLifecycleService,
			});
			registerRepositorySettingsHandlers({
				databaseService,
				getLanguage,
				resolvePermissionMode,
			});
			registerSettingsPublicationHandlers({
				service: settingsPublicationService,
			});
			registerWorkspaceFilesHandlers({
				listWorkspaceFilesService,
				workspaceFilesWatcher,
			});
			registerWorkspaceGitHandlers({
				workspaceGitService: createWorkspaceGitService({ localCommandService }),
			});
			const service = createGithubService({
				databaseService,
				localCommandService,
				readCoAuthorEnabled: () =>
					appSettingsService.read().git.coAuthorEnsemblr,
			});
			registerGithubHandlers({ githubService: service });
			registerRepositorySourcesHandlers({
				repositorySourcesService: createRepositorySourcesService({
					databaseService,
					localCommandService,
				}),
			});
			return service;
		} finally {
			restorePermissionGate();
		}
	};
	const githubService = registerGatedHandlerGroups();

	const prStatusSweeper = createWorkspacePrStatusSweeper({
		listActiveWorkspaces: () => {
			const database = databaseService.getConnection()?.database ?? null;
			return database ? listSweepableWorkspaces({ database }) : [];
		},
		refreshSnapshot: async ({ workspaceCwd, workspaceId }) => {
			await githubService.getPullRequestSnapshot({ workspaceCwd, workspaceId });
		},
	});
	const armSweeper = setTimeout(
		() => prStatusSweeper.start(),
		PR_SWEEP_START_DELAY_MS,
	);

	return {
		dispose: () => {
			clearTimeout(armSweeper);
			prStatusSweeper.dispose();
		},
	};
}
