import { contextBridge, ipcRenderer } from 'electron';

import { type InitialShellSnapshot, IPC_CHANNELS } from '../shared/ipc';
import { createEnsembleApi } from './bridge';

contextBridge.exposeInMainWorld('ensemble', createEnsembleApi());

try {
	const snapshot = ipcRenderer.sendSync(IPC_CHANNELS.initialShellSnapshot) as
		| InitialShellSnapshot
		| undefined;
	if (snapshot) {
		contextBridge.exposeInMainWorld('ensembleInitialShellSnapshot', snapshot);
	}
} catch {
	// Preload-time seeding is a best-effort optimization; fall back to async queries.
}
