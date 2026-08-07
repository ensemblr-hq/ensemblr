import type { AgentModelOption } from '../../shared/ipc/contracts/agent-models';
import type { AgentProviderService } from '../agent-providers';
import type { AgentSessionService } from '../agent-runtime';
import type { HarnessDetectionService } from '../agents/index.ts';
import { createChatTabService } from '../chat-tabs/index.ts';
import type { LocalCommandService } from '../commands/local-command';
import type {
	AppSettingsService,
	EnsemblrConfigResolutionService,
	EnsemblrConfigService,
	RepositoryConfigService,
} from '../config';
import type { EnvironmentVariablesService } from '../environment';
import {
	createGithubService,
	createWorkspacePrStatusSweeper,
} from '../github/index.ts';
import type { LinearAuthService, LinearService } from '../linear';
import type { OpenTargetService } from '../open-target';
import type { PiExecutableService } from '../pi-runtime';
import type { PlanModeRegistry } from '../plan-mode';
import type {
	ArchiveRepositoryService,
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
import { listActiveWorkspacePathRows } from '../storage/repositories/workspace-repository';
import type { TerminalService } from '../terminal';
import type {
	ListWorkspaceFilesService,
	WorkspaceFilesWatcher,
} from '../workspace-files';
import { createWorkspaceGitService } from '../workspace-git';
import { registerAgentProviderHandlers } from './handlers/agent-provider';
import { registerAgentSessionHandlers } from './handlers/agent-session';
import { registerAgentHandlers } from './handlers/agents';
import { registerAppSettingsHandlers } from './handlers/app-settings';
import { registerChatTabHandlers } from './handlers/chat-tab';
import { registerCheckpointHandlers } from './handlers/checkpoint';
import { registerCloneHandlers } from './handlers/clone';
import { registerEnvironmentHandlers } from './handlers/environment';
import { registerGithubHandlers } from './handlers/github';
import { registerHealthHandlers } from './handlers/health';
import { registerLinearHandlers } from './handlers/linear';
import { registerNavigationHandlers } from './handlers/navigation';
import { registerOpenTargetHandlers } from './handlers/open-target';
import { registerPiHandlers } from './handlers/pi';
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
	archiveRepositoryService: ArchiveRepositoryService;
	archiveWorkspaceService: ArchiveWorkspaceService;
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
	environmentVariablesService: EnvironmentVariablesService;
	githubCloneService: GithubCloneService;
	harnessDetectionService: HarnessDetectionService;
	githubRepositoryListService: GithubRepositoryListService;
	linearAuthService: LinearAuthService;
	linearService: LinearService;
	listAllWorkspacesService: ListAllWorkspacesService;
	listArchivedWorkspacesService: ListArchivedWorkspacesService;
	/** Lists Claude Code's models for the merged composer catalog. */
	listClaudeModels?: () => Promise<readonly AgentModelOption[]>;
	listWorkspaceFilesService: ListWorkspaceFilesService;
	localCommandService: LocalCommandService;
	localRepositoryImportService: LocalRepositoryImportService;
	localRepositoryRegistrationService: LocalRepositoryRegistrationService;
	/** Fired after an in-app App-settings write so side-effects can re-read. */
	onAppSettingsUpdated?: () => void;
	openTargetService: OpenTargetService;
	piExecutableService: PiExecutableService;
	agentSessionService: AgentSessionService;
	planModeRegistry: PlanModeRegistry;
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
	archiveRepositoryService,
	archiveWorkspaceService,
	augmentHarnessCommand,
	configService,
	continueWorkspaceBranchService,
	createWorkspaceService,
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
	listClaudeModels,
	listWorkspaceFilesService,
	localCommandService,
	localRepositoryImportService,
	localRepositoryRegistrationService,
	onAppSettingsUpdated,
	openTargetService,
	piExecutableService,
	agentSessionService,
	planModeRegistry,
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
	registerAppSettingsHandlers({ appSettingsService, onAppSettingsUpdated });
	registerEnvironmentHandlers({ environmentVariablesService });
	registerHealthHandlers({ configService, databaseService });
	registerShellSnapshotHandlers({
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
		archiveRepositoryService,
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
	registerPiHandlers({ piExecutableService });
	registerAgentProviderHandlers({ agentProviderService, openTargetService });
	registerAgentSessionHandlers({
		listClaudeModels,
		localCommandService,
		piExecutableService,
		agentSessionService,
		planModeRegistry,
		withPermissionGate,
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
	registerOpenTargetHandlers({
		appSettingsService,
		databaseService,
		openTargetService,
	});
	registerSetupHandlers({ setupDiagnosticsService });
	registerTerminalHandlers({ terminalService });
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
			return database ? listActiveWorkspacePathRows({ database }) : [];
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
