import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc/channels';
import type { InitialShellSnapshot } from '../shared/ipc/contracts/shell-snapshot';
import { createEnsemblrApi } from './bridge/ensemblr-api';

contextBridge.exposeInMainWorld('ensemblr', createEnsemblrApi());

try {
	const snapshot = ipcRenderer.sendSync(IPC_CHANNELS.initialShellSnapshot) as
		| InitialShellSnapshot
		| undefined;
	if (snapshot) {
		contextBridge.exposeInMainWorld('ensemblrInitialShellSnapshot', snapshot);
	}
} catch {
	// Preload-time seeding is a best-effort optimization; fall back to async queries.
}
