import { contextBridge, ipcRenderer } from 'electron';

import {
	type EnsembleApi,
	type HealthSnapshot,
	IPC_CHANNELS,
	type PiExecutableSelectionResult,
	type RootDirectorySnapshot,
	type SettingsResolutionRequest,
	type SettingsResolutionSnapshot,
	type SetupDiagnosticsSnapshot,
} from '../shared/ipc';

const api: EnsembleApi = {
	ensureWindowWidth: (minimumWidth: number) =>
		ipcRenderer.invoke(
			IPC_CHANNELS.ensureWindowWidth,
			minimumWidth,
		) as Promise<void>,
	health: () =>
		ipcRenderer.invoke(IPC_CHANNELS.health) as Promise<HealthSnapshot>,
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
	resolveSettings: (request?: SettingsResolutionRequest) =>
		ipcRenderer.invoke(
			IPC_CHANNELS.settingsResolution,
			request,
		) as Promise<SettingsResolutionSnapshot>,
};

contextBridge.exposeInMainWorld('ensemble', api);
