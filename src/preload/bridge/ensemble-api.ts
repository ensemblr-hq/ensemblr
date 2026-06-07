import { type IpcRendererEvent, ipcRenderer } from 'electron';

import {
	type CloneDestinationSelectionResult,
	type CloneGithubRepositoryPrepareResult,
	type CloneGithubRepositoryProgressEvent,
	type CloneGithubRepositoryRequest,
	type CloneGithubRepositoryStartRequest,
	type CloneGithubRepositoryStartResult,
	type EnsembleApi,
	type EnvironmentVariablesSnapshot,
	type GithubRepositoryListResult,
	type HealthSnapshot,
	IPC_CHANNELS,
	type LocalRepositorySelectionResult,
	type PiExecutableSelectionResult,
	type RegisterLocalRepositoryRequest,
	type RegisterLocalRepositoryResult,
	type RepositoryConfigMigrationPreview,
	type RepositoryConfigMigrationRequest,
	type RepositoryConfigMigrationResult,
	type RepositoryConfigRequest,
	type RepositoryConfigSnapshot,
	type RepositoryWorkspaceNavigationSnapshot,
	type RootDirectoryChangeApplyResult,
	type RootDirectoryChangeRequest,
	type RootDirectorySelectionResult,
	type RootDirectorySnapshot,
	type SettingsResolutionRequest,
	type SettingsResolutionSnapshot,
	type SetupDiagnosticsSnapshot,
} from '../../shared/ipc';

/**
 * Builds the `window.ensemble` bridge object exposed to the renderer, mapping
 * each typed method to its corresponding `ipcRenderer.invoke` call.
 * @returns A fully-populated {@link EnsembleApi}.
 */
export function createEnsembleApi(): EnsembleApi {
	return {
		applyRepositoryConfigMigration: (
			request: RepositoryConfigMigrationRequest,
		) =>
			ipcRenderer.invoke(
				IPC_CHANNELS.applyRepositoryConfigMigration,
				request,
			) as Promise<RepositoryConfigMigrationResult>,
		confirmRootDirectoryChange: (request: RootDirectoryChangeRequest) =>
			ipcRenderer.invoke(
				IPC_CHANNELS.confirmRootDirectoryChange,
				request,
			) as Promise<RootDirectoryChangeApplyResult>,
		ensureWindowWidth: (minimumWidth: number) =>
			ipcRenderer.invoke(
				IPC_CHANNELS.ensureWindowWidth,
				minimumWidth,
			) as Promise<void>,
		environmentVariables: () =>
			ipcRenderer.invoke(
				IPC_CHANNELS.environmentVariables,
			) as Promise<EnvironmentVariablesSnapshot>,
		githubRepositoryList: () =>
			ipcRenderer.invoke(
				IPC_CHANNELS.githubRepositoryList,
			) as Promise<GithubRepositoryListResult>,
		health: () =>
			ipcRenderer.invoke(IPC_CHANNELS.health) as Promise<HealthSnapshot>,
		onCloneGithubRepositoryProgress: (
			listener: (event: CloneGithubRepositoryProgressEvent) => void,
		) => {
			const wrapped = (
				_event: IpcRendererEvent,
				payload: CloneGithubRepositoryProgressEvent,
			) => {
				listener(payload);
			};
			ipcRenderer.on(IPC_CHANNELS.cloneGithubRepositoryProgress, wrapped);
			return () => {
				ipcRenderer.off(IPC_CHANNELS.cloneGithubRepositoryProgress, wrapped);
			};
		},
		prepareCloneGithubRepository: (request: CloneGithubRepositoryRequest) =>
			ipcRenderer.invoke(
				IPC_CHANNELS.cloneGithubRepositoryPrepare,
				request,
			) as Promise<CloneGithubRepositoryPrepareResult>,
		registerLocalRepository: (request: RegisterLocalRepositoryRequest) =>
			ipcRenderer.invoke(
				IPC_CHANNELS.registerLocalRepository,
				request,
			) as Promise<RegisterLocalRepositoryResult>,
		selectCloneDestination: () =>
			ipcRenderer.invoke(
				IPC_CHANNELS.selectCloneDestination,
			) as Promise<CloneDestinationSelectionResult>,
		selectLocalRepository: () =>
			ipcRenderer.invoke(
				IPC_CHANNELS.selectLocalRepository,
			) as Promise<LocalRepositorySelectionResult>,
		startCloneGithubRepository: (request: CloneGithubRepositoryStartRequest) =>
			ipcRenderer.invoke(
				IPC_CHANNELS.cloneGithubRepositoryStart,
				request,
			) as Promise<CloneGithubRepositoryStartResult>,
		previewRepositoryConfigMigration: (
			request: RepositoryConfigMigrationRequest,
		) =>
			ipcRenderer.invoke(
				IPC_CHANNELS.previewRepositoryConfigMigration,
				request,
			) as Promise<RepositoryConfigMigrationPreview>,
		repositoryConfig: (request: RepositoryConfigRequest) =>
			ipcRenderer.invoke(
				IPC_CHANNELS.repositoryConfig,
				request,
			) as Promise<RepositoryConfigSnapshot>,
		repositoryWorkspaceNavigation: () =>
			ipcRenderer.invoke(
				IPC_CHANNELS.repositoryWorkspaceNavigation,
			) as Promise<RepositoryWorkspaceNavigationSnapshot>,
		rootDirectory: () =>
			ipcRenderer.invoke(
				IPC_CHANNELS.rootDirectory,
			) as Promise<RootDirectorySnapshot>,
		setupDiagnostics: () =>
			ipcRenderer.invoke(
				IPC_CHANNELS.setupDiagnostics,
			) as Promise<SetupDiagnosticsSnapshot>,
		selectPiExecutable: () =>
			ipcRenderer.invoke(
				IPC_CHANNELS.selectPiExecutable,
			) as Promise<PiExecutableSelectionResult>,
		selectRootDirectory: () =>
			ipcRenderer.invoke(
				IPC_CHANNELS.selectRootDirectory,
			) as Promise<RootDirectorySelectionResult>,
		resolveSettings: (request?: SettingsResolutionRequest) =>
			ipcRenderer.invoke(
				IPC_CHANNELS.settingsResolution,
				request,
			) as Promise<SettingsResolutionSnapshot>,
	};
}
