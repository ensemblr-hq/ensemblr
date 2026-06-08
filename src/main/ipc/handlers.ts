import type {
	EnsembleConfigResolutionService,
	EnsembleConfigService,
	RepositoryConfigService,
} from '../config';
import type { EnvironmentVariablesService } from '../environment';
import type { PiExecutableService } from '../pi';
import type {
	ArchiveRepositoryService,
	ArchiveWorkspaceService,
	CreateWorkspaceService,
	GithubCloneService,
	GithubRepositoryListService,
	LocalRepositoryRegistrationService,
	QuickStartProjectService,
	RenameWorkspaceService,
	SharedRootAdoptionService,
} from '../repository';
import type { EnsembleRootDirectoryService } from '../root';
import type { SetupDiagnosticsService } from '../setup';
import type { EnsembleDatabaseService } from '../storage';
import { registerCloneHandlers } from './handlers/clone';
import { registerCoreHandlers } from './handlers/core';
import { registerPiHandlers } from './handlers/pi';
import { registerRepositoryHandlers } from './handlers/repository';
import { registerRepositoryConfigHandlers } from './handlers/repository-config';
import { registerRootHandlers } from './handlers/root';
import { registerSetupHandlers } from './handlers/setup';

/** Dependency bundle wired into the renderer-facing IPC handlers. */
interface RegisterIpcHandlersOptions {
	archiveRepositoryService: ArchiveRepositoryService;
	archiveWorkspaceService: ArchiveWorkspaceService;
	configService: EnsembleConfigService;
	createWorkspaceService: CreateWorkspaceService;
	databaseService: EnsembleDatabaseService;
	environmentVariablesService: EnvironmentVariablesService;
	githubCloneService: GithubCloneService;
	githubRepositoryListService: GithubRepositoryListService;
	localRepositoryRegistrationService: LocalRepositoryRegistrationService;
	piExecutableService: PiExecutableService;
	quickStartProjectService: QuickStartProjectService;
	renameWorkspaceService: RenameWorkspaceService;
	repositoryConfigService: RepositoryConfigService;
	rootDirectoryService: EnsembleRootDirectoryService;
	sharedRootAdoptionService: SharedRootAdoptionService;
	setupDiagnosticsService: SetupDiagnosticsService;
	settingsResolutionService: EnsembleConfigResolutionService;
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
	environmentVariablesService,
	githubCloneService,
	githubRepositoryListService,
	localRepositoryRegistrationService,
	piExecutableService,
	quickStartProjectService,
	renameWorkspaceService,
	repositoryConfigService,
	rootDirectoryService,
	setupDiagnosticsService,
	settingsResolutionService,
	sharedRootAdoptionService,
}: RegisterIpcHandlersOptions): void {
	registerCoreHandlers({
		configService,
		databaseService,
		environmentVariablesService,
		settingsResolutionService,
	});
	registerRootHandlers({ rootDirectoryService, sharedRootAdoptionService });
	registerRepositoryConfigHandlers({
		databaseService,
		repositoryConfigService,
	});
	registerRepositoryHandlers({
		archiveRepositoryService,
		archiveWorkspaceService,
		createWorkspaceService,
		localRepositoryRegistrationService,
		quickStartProjectService,
		renameWorkspaceService,
		sharedRootAdoptionService,
	});
	registerCloneHandlers({
		githubCloneService,
		githubRepositoryListService,
	});
	registerPiHandlers({ piExecutableService });
	registerSetupHandlers({ setupDiagnosticsService });
}
