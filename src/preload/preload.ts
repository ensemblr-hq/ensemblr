import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc/channels';
import type { InitialShellSnapshot } from '../shared/ipc/contracts/shell-snapshot';
import { createEnsembleApi } from './bridge/ensemble-api';

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
