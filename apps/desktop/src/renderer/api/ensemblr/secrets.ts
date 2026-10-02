import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type { ObfuscatedStorageStatus } from '@/shared/ipc/contracts/secrets';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

/**
 * Query options for the keyring backend behind the secret store and whether
 * the user has already accepted it.
 */
export const obfuscatedStorageStatusQuery = queryOptions({
	/** Fetches the current backend and acknowledgement state over IPC with call profiling. */
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemblr:get-obfuscated-storage-status', usesDatabase: true },
			() => getEnsemblrApi().getObfuscatedStorageStatus(),
		),
	queryKey: ensemblrQueryKeys.obfuscatedStorageStatus(),
	staleTime: 2000,
});

/**
 * Records that the user accepts storing secrets under the session's current
 * keyring backend, even though it only obfuscates rather than encrypts.
 * @returns The status after recording the acknowledgement.
 */
export function acknowledgeObfuscatedStorage(): Promise<ObfuscatedStorageStatus> {
	return getEnsemblrApi().acknowledgeObfuscatedStorage();
}
