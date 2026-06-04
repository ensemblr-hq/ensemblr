import { contextBridge, ipcRenderer } from 'electron';

import {
	type HealthSnapshot,
	IPC_CHANNELS,
	type PiductorApi,
} from '../shared/ipc';

const api: PiductorApi = {
	health: () =>
		ipcRenderer.invoke(IPC_CHANNELS.health) as Promise<HealthSnapshot>,
};

contextBridge.exposeInMainWorld('piductor', api);
