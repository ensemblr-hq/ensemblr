import type {
	EnsembleConfigResolutionService,
	EnsembleConfigService,
	RepositoryConfigService,
} from '../config';
import type { EnvironmentVariablesService } from '../environment';
import type { PiExecutableService } from '../pi';
import type {
	CreateWorkspaceService,
	GithubCloneService,
	GithubRepositoryListService,
	LocalRepositoryRegistrationService,
	QuickStartProjectService,
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
	configService: EnsembleConfigService;
	createWorkspaceService: CreateWorkspaceService;
	databaseService: EnsembleDatabaseService;
	environmentVariablesService: EnvironmentVariablesService;
	githubCloneService: GithubCloneService;
	githubRepositoryListService: GithubRepositoryListService;
	localRepositoryRegistrationService: LocalRepositoryRegistrationService;
	piExecutableService: PiExecutableService;
	quickStartProjectService: QuickStartProjectService;
	repositoryConfigService: RepositoryConfigService;
	rootDirectoryService: EnsembleRootDirectoryService;
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
	configService,
	createWorkspaceService,
	databaseService,
	environmentVariablesService,
	githubCloneService,
	githubRepositoryListService,
	localRepositoryRegistrationService,
	piExecutableService,
	quickStartProjectService,
	repositoryConfigService,
	rootDirectoryService,
	setupDiagnosticsService,
	settingsResolutionService,
}: RegisterIpcHandlersOptions): void {
	registerCoreHandlers({
		configService,
		databaseService,
		environmentVariablesService,
		settingsResolutionService,
	});
	registerRootHandlers({ rootDirectoryService });
	registerRepositoryConfigHandlers({
		databaseService,
		repositoryConfigService,
	});
	registerRepositoryHandlers({
		createWorkspaceService,
		localRepositoryRegistrationService,
		quickStartProjectService,
	});
	registerCloneHandlers({
		githubCloneService,
		githubRepositoryListService,
	});
	registerPiHandlers({ piExecutableService });
	registerSetupHandlers({ setupDiagnosticsService });
}
