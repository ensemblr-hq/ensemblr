import type { LocalCommandService } from '../commands/local-command';
import type {
	EnsembleConfigResolutionService,
	EnsembleConfigService,
	RepositoryConfigService,
} from '../config';
import type { EnvironmentVariablesService } from '../environment';
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
import type { EnsembleRootDirectoryService } from '../root';
import type { SetupDiagnosticsService } from '../setup';
import type { EnsembleDatabaseService } from '../storage';
import { registerChatTabHandlers } from './handlers/chat-tab';
import { registerCloneHandlers } from './handlers/clone';
import { registerEnvironmentHandlers } from './handlers/environment';
import { registerHealthHandlers } from './handlers/health';
import { registerNavigationHandlers } from './handlers/navigation';
import { registerPiHandlers } from './handlers/pi';
import { registerPiSessionHandlers } from './handlers/pi-session';
import { registerRepositoryHandlers } from './handlers/repository';
import { registerRepositoryConfigHandlers } from './handlers/repository-config';
import { registerRootHandlers } from './handlers/root';
import { registerSettingsHandlers } from './handlers/settings';
import { registerSetupHandlers } from './handlers/setup';
import { registerWindowHandlers } from './handlers/window';

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
	listArchivedWorkspacesService: ListArchivedWorkspacesService;
	localCommandService: LocalCommandService;
	localRepositoryRegistrationService: LocalRepositoryRegistrationService;
	piExecutableService: PiExecutableService;
	piSessionService: PiSessionService;
	quickStartProjectService: QuickStartProjectService;
	renameWorkspaceService: RenameWorkspaceService;
	repositoryConfigService: RepositoryConfigService;
	rootDirectoryService: EnsembleRootDirectoryService;
	sharedRootAdoptionService: SharedRootAdoptionService;
	setupDiagnosticsService: SetupDiagnosticsService;
	settingsResolutionService: EnsembleConfigResolutionService;
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
	listArchivedWorkspacesService,
	localCommandService,
	localRepositoryRegistrationService,
	piExecutableService,
	piSessionService,
	quickStartProjectService,
	renameWorkspaceService,
	repositoryConfigService,
	rootDirectoryService,
	setupDiagnosticsService,
	settingsResolutionService,
	sharedRootAdoptionService,
	unarchiveWorkspaceService,
}: RegisterIpcHandlersOptions): void {
	registerWindowHandlers();
	registerEnvironmentHandlers({ environmentVariablesService });
	registerHealthHandlers({ configService, databaseService });
	registerNavigationHandlers({ databaseService });
	registerSettingsHandlers({ settingsResolutionService });
	registerRootHandlers({ rootDirectoryService, sharedRootAdoptionService });
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
	});
	registerCloneHandlers({
		githubCloneService,
		githubRepositoryListService,
	});
	registerPiHandlers({ piExecutableService });
	registerPiSessionHandlers({
		localCommandService,
		piExecutableService,
		piSessionService,
	});
	registerChatTabHandlers({ databaseService });
	registerSetupHandlers({ setupDiagnosticsService });
}
