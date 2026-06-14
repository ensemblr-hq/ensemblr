import { contextBridge, ipcRenderer } from 'electron';

import { type InitialShellSnapshot } from '../shared/ipc/contracts/repository-navigation';
import { IPC_CHANNELS } from '../shared/ipc/channels';
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
