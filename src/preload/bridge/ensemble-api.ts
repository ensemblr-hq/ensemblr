import { ipcRenderer } from 'electron';

import {
	type EnsembleApi,
	type EnvironmentVariablesSnapshot,
	type HealthSnapshot,
	IPC_CHANNELS,
	type PiExecutableSelectionResult,
	type RepositoryConfigMigrationPreview,
	type RepositoryConfigMigrationRequest,
	type RepositoryConfigMigrationResult,
	type RepositoryConfigRequest,
	type RepositoryConfigSnapshot,
	type RootDirectoryChangeApplyResult,
	type RootDirectoryChangeRequest,
	type RootDirectorySelectionResult,
	type RootDirectorySnapshot,
	type SettingsResolutionRequest,
	type SettingsResolutionSnapshot,
	type SetupDiagnosticsSnapshot,
} from '../../shared/ipc';

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
		health: () =>
			ipcRenderer.invoke(IPC_CHANNELS.health) as Promise<HealthSnapshot>,
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
