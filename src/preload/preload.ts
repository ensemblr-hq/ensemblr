import { contextBridge, ipcRenderer } from 'electron';

import {
	type HealthSnapshot,
	IPC_CHANNELS,
	type PiductorApi,
	type RootDirectorySnapshot,
	type SettingsResolutionRequest,
	type SettingsResolutionSnapshot,
} from '../shared/ipc';

const api: PiductorApi = {
	health: () =>
		ipcRenderer.invoke(IPC_CHANNELS.health) as Promise<HealthSnapshot>,
	rootDirectory: () =>
		ipcRenderer.invoke(
			IPC_CHANNELS.rootDirectory,
		) as Promise<RootDirectorySnapshot>,
	resolveSettings: (request?: SettingsResolutionRequest) =>
		ipcRenderer.invoke(
			IPC_CHANNELS.settingsResolution,
			request,
		) as Promise<SettingsResolutionSnapshot>,
};

contextBridge.exposeInMainWorld('piductor', api);
