import { createChatTabService } from '../chat-tabs/chat-tab-service';
import type { LocalCommandService } from '../commands/local-command';
import type {
	EnsembleConfigResolutionService,
	EnsembleConfigService,
	RepositoryConfigService,
} from '../config';
import type { EnvironmentVariablesService } from '../environment';
import { createGithubService } from '../github';
import type { LinearAuthService, LinearService } from '../linear';
import type { PiSessionService } from '../pi-agent/pi-session-service';
import type { PiExecutableService } from '../pi-runtime';
import type {
	ArchiveRepositoryService,
	ArchiveWorkspaceService,
	CreateWorkspaceService,
	DeleteArchivedWorkspaceService,
	DeleteRepositoryService,
	DeleteWorkspaceService,
	GithubCloneService,
	GithubRepositoryListService,
	ListArchivedWorkspacesService,
	LocalRepositoryRegistrationService,
	QuickStartProjectService,
	RenameWorkspaceService,
	SharedRootAdoptionService,
	UnarchiveWorkspaceService,
} from '../repository';
import { createReviewService } from '../review';
import type { EnsembleRootDirectoryService } from '../root';
import type { ScriptLifecycleService } from '../scripts';
import type { SetupDiagnosticsService } from '../setup';
import type { EnsembleDatabaseService } from '../storage';
import { getPiSessionById } from '../storage/repositories/pi-session-repository';
import { getWorkspacePathById } from '../storage/repositories/workspace-repository';
import type { TerminalService } from '../terminal';
import type { ListWorkspaceFilesService } from '../workspace-files';
import { createWorkspaceGitService } from '../workspace-git';
import { registerChatTabHandlers } from './handlers/chat-tab';
import { registerCheckpointHandlers } from './handlers/checkpoint';
import { registerCloneHandlers } from './handlers/clone';
import { registerEnvironmentHandlers } from './handlers/environment';
import { registerGithubHandlers } from './handlers/github';
import { registerHealthHandlers } from './handlers/health';
import { registerLinearHandlers } from './handlers/linear';
import { registerNavigationHandlers } from './handlers/navigation';
import { registerPiHandlers } from './handlers/pi';
import { registerPiSessionHandlers } from './handlers/pi-session';
import { registerRepositoryHandlers } from './handlers/repository';
import { registerRepositoryConfigHandlers } from './handlers/repository-config';
import { registerReviewHandlers } from './handlers/review';
import { registerRootHandlers } from './handlers/root';
import { registerSettingsHandlers } from './handlers/settings';
import { registerSetupHandlers } from './handlers/setup';
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
	archiveRepositoryService: ArchiveRepositoryService;
	archiveWorkspaceService: ArchiveWorkspaceService;
	configService: EnsembleConfigService;
	createWorkspaceService: CreateWorkspaceService;
	databaseService: EnsembleDatabaseService;
	deleteArchivedWorkspaceService: DeleteArchivedWorkspaceService;
	deleteRepositoryService: DeleteRepositoryService;
	deleteWorkspaceService: DeleteWorkspaceService;
	environmentVariablesService: EnvironmentVariablesService;
	githubCloneService: GithubCloneService;
	githubRepositoryListService: GithubRepositoryListService;
	linearAuthService: LinearAuthService;
	linearService: LinearService;
	listArchivedWorkspacesService: ListArchivedWorkspacesService;
	listWorkspaceFilesService: ListWorkspaceFilesService;
	localCommandService: LocalCommandService;
	localRepositoryRegistrationService: LocalRepositoryRegistrationService;
	piExecutableService: PiExecutableService;
	piSessionService: PiSessionService;
	quickStartProjectService: QuickStartProjectService;
	renameWorkspaceService: RenameWorkspaceService;
	repositoryConfigService: RepositoryConfigService;
	rootDirectoryService: EnsembleRootDirectoryService;
	scriptLifecycleService: ScriptLifecycleService;
	sharedRootAdoptionService: SharedRootAdoptionService;
	setupDiagnosticsService: SetupDiagnosticsService;
	settingsResolutionService: EnsembleConfigResolutionService;
	terminalService: TerminalService;
	unarchiveWorkspaceService: UnarchiveWorkspaceService;
}

/**
 * Composition root for every renderer-facing `ipcMain` handler. Each domain
 * group lives in its own `handlers/<domain>.ts` file and receives only the
 * services it needs.
 * @param options - Service dependencies the handlers delegate to.
 */
export function registerIpcHandlers({
	archiveRepositoryService,
	archiveWorkspaceService,
	configService,
	createWorkspaceService,
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
	localRepositoryRegistrationService,
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
}: RegisterIpcHandlersOptions): void {
	// Permission gate is wired here so all handler groups share one instance.
	// `getMode` re-resolves on every gated call so settings changes apply live.
	const withPermissionGate = createPermissionGate({
		getMode: () =>
			readPermissionModeFromSnapshot(settingsResolutionService.resolve()),
	});

	registerWindowHandlers();
	registerEnvironmentHandlers({ environmentVariablesService });
	registerHealthHandlers({ configService, databaseService });
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
		createWorkspaceService,
		deleteArchivedWorkspaceService,
		deleteRepositoryService,
		deleteWorkspaceService,
		listArchivedWorkspacesService,
		localRepositoryRegistrationService,
		quickStartProjectService,
		renameWorkspaceService,
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
	registerPiSessionHandlers({
		localCommandService,
		piExecutableService,
		piSessionService,
		withPermissionGate,
	});
	registerChatTabHandlers({
		chatTabService: createChatTabService({
			databaseService,
			lookups: {
				piSessionExists: ({ piSessionId }) => {
					const database = databaseService.getConnection()?.database;
					if (!database) {
						return false;
					}
					return getPiSessionById({ database, id: piSessionId }) !== null;
				},
				workspaceCwd: ({ workspaceId }) => {
					const database = databaseService.getConnection()?.database;
					if (!database) {
						return null;
					}
					return getWorkspacePathById({ database, workspaceId });
				},
			},
		}),
	});
	registerCheckpointHandlers({ databaseService });
	registerReviewHandlers({
		reviewService: createReviewService({ databaseService }),
	});
	registerLinearHandlers({ linearAuthService, linearService });
	registerSetupHandlers({ setupDiagnosticsService });
	registerTerminalHandlers({ terminalService });
	registerWorkspaceScriptHandlers({ scriptLifecycleService });
	registerWorkspaceFilesHandlers({ listWorkspaceFilesService });
	registerWorkspaceGitHandlers({
		workspaceGitService: createWorkspaceGitService({ localCommandService }),
	});
	registerGithubHandlers({
		githubService: createGithubService({
			databaseService,
			localCommandService,
		}),
		withPermissionGate,
	});
}
