import type {
	AgentModelCatalogService,
	AgentProviderService,
} from '../agent-providers';
import type { AgentSessionService } from '../agent-runtime';
import type { ActiveChatStore } from '../agent-runtime/active-chat-store.ts';
import type { QueueProvisionalNamingPort } from '../agent-runtime/naming/provisional-workspace-naming';
import type { HarnessDetectionService } from '../agents/index.ts';
import { createChatTabService } from '../chat-tabs/index.ts';
import type { LocalCommandService } from '../commands/local-command';
import type { ConciergeSessionService } from '../concierge';
import type {
	AppSettingsService,
	EnsemblrConfigResolutionService,
	EnsemblrConfigService,
	RepositoryConfigService,
} from '../config';
import type { DictationService } from '../dictation';
import type { EnvironmentVariablesService } from '../environment';
import {
	createGithubService,
	createWorkspacePrStatusSweeper,
	listSweepableWorkspaces,
} from '../github/index.ts';
import type { InfisicalService } from '../infisical';
import type { LinearAuthService, LinearService } from '../linear';
import { createLinkedDirectoryService } from '../linked-directories/index.ts';
import type { MenuContextStore } from '../menu';
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
	GithubRepositoryListService,
	ListAllWorkspacesService,
	ListArchivedWorkspacesService,
	LocalRepositoryImportService,
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
import { registerSettingsHandlers } from './handlers/settings';
import { registerSetupHandlers } from './handlers/setup';
import { registerShellSnapshotHandlers } from './handlers/shell-snapshot';
import { registerTerminalHandlers } from './handlers/terminal';
import { registerTextEditingHandlers } from './handlers/text-editing';
import { registerUpdateHandlers } from './handlers/update';
import { registerWindowHandlers } from './handlers/window';
import { registerWorkspaceFilesHandlers } from './handlers/workspace-files';
import { registerWorkspaceGitHandlers } from './handlers/workspace-git';
import { registerWorkspaceScriptHandlers } from './handlers/workspace-scripts';
import {
	createPermissionGate,
	readPermissionModeFromSnapshot,
} from './permission-gate';

/** Dependency bundle wired into the renderer-facing IPC handlers. */
interface RegisterIpcHandlersOptions {
	agentProviderService: AgentProviderService;
	appSettingsService: AppSettingsService;
	archiveWorkspaceService: ArchiveWorkspaceService;
	conciergeSessionService: ConciergeSessionService;
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
	githubCloneService: GithubCloneService;
	harnessDetectionService: HarnessDetectionService;
	githubRepositoryListService: GithubRepositoryListService;
	linearAuthService: LinearAuthService;
	linearService: LinearService;
	listAllWorkspacesService: ListAllWorkspacesService;
	listArchivedWorkspacesService: ListArchivedWorkspacesService;
	listWorkspaceFilesService: ListWorkspaceFilesService;
	localCommandService: LocalCommandService;
	localRepositoryImportService: LocalRepositoryImportService;
	localRepositoryRegistrationService: LocalRepositoryRegistrationService;
	/** Holds the chat the renderer reports as on screen, read by the desktop notifier. */
	activeChatStore: ActiveChatStore;
	/** Holds the menu context the renderer reports, shared with the menu rebuild. */
	menuContextStore: MenuContextStore;
	/** Reinstalls the native application menu from the current settings and menu context. */
	rebuildMenu: () => void;
	/** Fired after an in-app App-settings write so side-effects can re-read. */
	onAppSettingsUpdated?: () => void;
	openTargetService: OpenTargetService;
	piExecutableService: PiExecutableService;
	/** Merged per-runtime model catalog, shared with the agent-control spawn path. */
	agentModelCatalog: AgentModelCatalogService;
	agentSessionService: AgentSessionService;
	planModeRegistry: PlanModeRegistry;
	/** Names a planning workspace from its first prompt, ahead of the agent. */
	provisionalNamingQueue: QueueProvisionalNamingPort;
	quickStartProjectService: QuickStartProjectService;
	renameWorkspaceService: RenameWorkspaceService;
	repositoryConfigService: RepositoryConfigService;
	rootDirectoryService: EnsemblrRootDirectoryService;
	scriptLifecycleService: ScriptLifecycleService;
	setWorkspaceBaseBranchService: SetWorkspaceBaseBranchService;
	sharedRootAdoptionService: SharedRootAdoptionService;
	setupDiagnosticsService: SetupDiagnosticsService;
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
	menuContextStore,
	onAppSettingsUpdated,
	activeChatStore,
	openTargetService,
	rebuildMenu,
	piExecutableService,
	agentModelCatalog,
	agentSessionService,
	conciergeSessionService,
	planModeRegistry,
	provisionalNamingQueue,
	quickStartProjectService,
	renameWorkspaceService,
	repositoryConfigService,
	rootDirectoryService,
	scriptLifecycleService,
	setWorkspaceBaseBranchService,
	setupDiagnosticsService,
	settingsResolutionService,
	sharedRootAdoptionService,
	terminalService,
	updateService,
	unarchiveWorkspaceService,
	workspaceFilesWatcher,
}: RegisterIpcHandlersOptions): IpcHandlersHandle {
	// Permission gate is wired here so all handler groups share one instance.
	// `getMode` re-resolves on every gated call so settings changes apply live.
	const withPermissionGate = createPermissionGate({
		getMode: () =>
			readPermissionModeFromSnapshot(settingsResolutionService.resolve()),
	});

	registerWindowHandlers();
	registerTextEditingHandlers();
	registerMenuHandlers({ menuContextStore, rebuildMenu });
	registerActiveChatHandlers({ activeChatStore });
	registerAppSettingsHandlers({ appSettingsService, onAppSettingsUpdated });
	registerDictationHandlers({ dictationService });
	registerEnvironmentHandlers({ environmentVariablesService });
	registerInfisicalHandlers({ getInfisicalService });
	registerHealthHandlers({ configService, databaseService });
	registerShellSnapshotHandlers({
		appSettingsService,
		configService,
		databaseService,
		openTargetService,
	});
	registerNavigationHandlers({ databaseService });
	registerSettingsHandlers({ settingsResolutionService });
	registerRootHandlers({
		rootDirectoryService,
		sharedRootAdoptionService,
		withPermissionGate,
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
		listAllWorkspacesService,
		listArchivedWorkspacesService,
		localRepositoryImportService,
		localRepositoryRegistrationService,
		quickStartProjectService,
		renameWorkspaceService,
		setWorkspaceBaseBranchService,
		sharedRootAdoptionService,
		unarchiveWorkspaceService,
		withPermissionGate,
	});
	registerCloneHandlers({
		githubCloneService,
		githubRepositoryListService,
		withPermissionGate,
	});
	registerAgentProviderHandlers({ agentProviderService, openTargetService });
	registerAgentSessionHandlers({
		agentModelCatalog,
		agentSessionService,
		piExecutableService,
		planModeRegistry,
		provisionalNamingQueue,
		withPermissionGate,
	});
	registerConciergeHandlers({ conciergeSessionService });
	registerChatTabHandlers({
		chatTabService: createChatTabService({
			databaseService,
			lookups: {
				agentSessionExists: ({ agentSessionId }) => {
					const database = databaseService.getConnection()?.database;
					if (!database) {
						return false;
					}
					return getAgentSessionById({ database, id: agentSessionId }) !== null;
				},
			},
		}),
	});
	registerCheckpointHandlers({ databaseService });
	registerReviewHandlers({
		reviewService: createReviewService({ databaseService }),
	});
	registerLinearHandlers({ linearAuthService, linearService });
	registerLinkedDirectoryHandlers({
		linkedDirectoryService: createLinkedDirectoryService({ databaseService }),
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
		terminalService,
	});
	registerWorkspaceScriptHandlers({ databaseService, scriptLifecycleService });
	registerRepositorySettingsHandlers({ databaseService });
	registerWorkspaceFilesHandlers({
		listWorkspaceFilesService,
		workspaceFilesWatcher,
		withPermissionGate,
	});
	registerWorkspaceGitHandlers({
		workspaceGitService: createWorkspaceGitService({ localCommandService }),
	});
	const githubService = createGithubService({
		databaseService,
		localCommandService,
	});
	registerGithubHandlers({ githubService, withPermissionGate });
	const prStatusSweeper = createWorkspacePrStatusSweeper({
		listActiveWorkspaces: () => {
			const database = databaseService.getConnection()?.database ?? null;
			return database ? listSweepableWorkspaces({ database }) : [];
		},
		refreshSnapshot: async ({ workspaceCwd, workspaceId }) => {
			await githubService.getPullRequestSnapshot({ workspaceCwd, workspaceId });
		},
	});
	prStatusSweeper.start();
	registerRepositorySourcesHandlers({
		repositorySourcesService: createRepositorySourcesService({
			databaseService,
			localCommandService,
		}),
	});

	return { dispose: () => prStatusSweeper.dispose() };
}
