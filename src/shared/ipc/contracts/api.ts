import type {
	CloneDestinationSelectionResult,
	CloneGithubRepositoryPrepareResult,
	CloneGithubRepositoryProgressEvent,
	CloneGithubRepositoryRequest,
	CloneGithubRepositoryStartRequest,
	CloneGithubRepositoryStartResult,
	GithubRepositoryListResult,
} from './clone';
import type { EnvironmentVariablesSnapshot } from './environment';
import type { HealthSnapshot } from './health';
import type { PiExecutableSelectionResult } from './pi';
import type {
	QuickStartProjectRequest,
	QuickStartProjectResult,
} from './quick-start';
import type {
	ArchiveRepositoryRequest,
	ArchiveRepositoryResult,
	LocalRepositorySelectionResult,
	RegisterLocalRepositoryRequest,
	RegisterLocalRepositoryResult,
} from './repository';
import type {
	RepositoryConfigMigrationPreview,
	RepositoryConfigMigrationRequest,
	RepositoryConfigMigrationResult,
	RepositoryConfigRequest,
	RepositoryConfigSnapshot,
} from './repository-config';
import type { RepositoryWorkspaceNavigationSnapshot } from './repository-navigation';
import type {
	RootDirectoryChangeApplyResult,
	RootDirectoryChangeRequest,
	RootDirectorySelectionResult,
	RootDirectorySnapshot,
} from './root-directory';
import type {
	SettingsResolutionRequest,
	SettingsResolutionSnapshot,
} from './settings-resolution';
import type { SetupDiagnosticsSnapshot } from './setup';
import type { SharedRootAdoptionSnapshot } from './shared-root-adoption';
import type {
	ArchiveWorkspaceRequest,
	ArchiveWorkspaceResult,
	CreateWorkspaceRequest,
	CreateWorkspaceResult,
	RenameWorkspaceRequest,
	RenameWorkspaceResult,
} from './workspace';

export interface EnsembleApi {
	confirmRootDirectoryChange: (
		request: RootDirectoryChangeRequest,
	) => Promise<RootDirectoryChangeApplyResult>;
	applyRepositoryConfigMigration: (
		request: RepositoryConfigMigrationRequest,
	) => Promise<RepositoryConfigMigrationResult>;
	archiveRepository: (
		request: ArchiveRepositoryRequest,
	) => Promise<ArchiveRepositoryResult>;
	archiveWorkspace: (
		request: ArchiveWorkspaceRequest,
	) => Promise<ArchiveWorkspaceResult>;
	createWorkspace: (
		request: CreateWorkspaceRequest,
	) => Promise<CreateWorkspaceResult>;
	ensureWindowWidth: (minimumWidth: number) => Promise<void>;
	environmentVariables: () => Promise<EnvironmentVariablesSnapshot>;
	githubRepositoryList: () => Promise<GithubRepositoryListResult>;
	health: () => Promise<HealthSnapshot>;
	onCloneGithubRepositoryProgress: (
		listener: (event: CloneGithubRepositoryProgressEvent) => void,
	) => () => void;
	prepareCloneGithubRepository: (
		request: CloneGithubRepositoryRequest,
	) => Promise<CloneGithubRepositoryPrepareResult>;
	previewRepositoryConfigMigration: (
		request: RepositoryConfigMigrationRequest,
	) => Promise<RepositoryConfigMigrationPreview>;
	quickStartProject: (
		request: QuickStartProjectRequest,
	) => Promise<QuickStartProjectResult>;
	repositoryConfig: (
		request: RepositoryConfigRequest,
	) => Promise<RepositoryConfigSnapshot>;
	registerLocalRepository: (
		request: RegisterLocalRepositoryRequest,
	) => Promise<RegisterLocalRepositoryResult>;
	repositoryWorkspaceNavigation: () => Promise<RepositoryWorkspaceNavigationSnapshot>;
	rootDirectory: () => Promise<RootDirectorySnapshot>;
	resolveSettings: (
		request?: SettingsResolutionRequest,
	) => Promise<SettingsResolutionSnapshot>;
	selectCloneDestination: () => Promise<CloneDestinationSelectionResult>;
	selectLocalRepository: () => Promise<LocalRepositorySelectionResult>;
	selectPiExecutable: () => Promise<PiExecutableSelectionResult>;
	selectRootDirectory: () => Promise<RootDirectorySelectionResult>;
	setupDiagnostics: () => Promise<SetupDiagnosticsSnapshot>;
	renameWorkspace: (
		request: RenameWorkspaceRequest,
	) => Promise<RenameWorkspaceResult>;
	sharedRootAdoption: () => Promise<SharedRootAdoptionSnapshot>;
	startCloneGithubRepository: (
		request: CloneGithubRepositoryStartRequest,
	) => Promise<CloneGithubRepositoryStartResult>;
}
