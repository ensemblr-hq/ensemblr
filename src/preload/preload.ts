import { contextBridge, ipcRenderer } from 'electron';

import {
	type HealthSnapshot,
	IPC_CHANNELS,
	type PiductorApi,
	type RootDirectorySnapshot,
	type SettingsResolutionRequest,
	type SettingsResolutionSnapshot,
	type SetupDiagnosticsSnapshot,
} from '../shared/ipc';

const api: PiductorApi = {
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
	resolveSettings: (request?: SettingsResolutionRequest) =>
		ipcRenderer.invoke(
			IPC_CHANNELS.settingsResolution,
			request,
		) as Promise<SettingsResolutionSnapshot>,
};

contextBridge.exposeInMainWorld('piductor', api);
