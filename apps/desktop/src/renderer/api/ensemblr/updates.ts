import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	UpdateStatusChangedBroadcast,
	UpdateStatusSnapshot,
} from '@/shared/ipc/contracts/update';

import { getEnsemblrApi, getEnsemblrApiOrNull } from './query-keys';

/** Subscribes to update-state transitions pushed by main; returns an unsubscribe fn. */
export function subscribeUpdateStatusChanged(
	listener: (event: UpdateStatusChangedBroadcast) => void,
): () => void {
	const api = getEnsemblrApiOrNull();
	return api ? api.onUpdateStatusChanged(listener) : () => undefined;
}

/** Reads the updater's current state, for the first render before any broadcast. */
export function readUpdateStatus(): Promise<UpdateStatusSnapshot> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:update-status', usesDatabase: false },
		() => getEnsemblrApi().updateStatus(),
	);
}

/** Asks main to check for a newer release now, rather than waiting for the schedule. */
export function checkForUpdates(): Promise<UpdateStatusSnapshot> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:check-for-updates', usesDatabase: false },
		() => getEnsemblrApi().checkForUpdates(),
	);
}

/** Restarts into a downloaded update, through the quit guard. */
export function installUpdate(): Promise<UpdateStatusSnapshot> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:install-update', usesDatabase: false },
		() => getEnsemblrApi().installUpdate(),
	);
}
