import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type { ObfuscatedStorageStatus } from '../../../shared/ipc/contracts/secrets';
import {
	OBFUSCATING_KEYRING_BACKEND,
	readObfuscatedStorageAcknowledgement,
	readSafeStorageStatus,
	writeObfuscatedStorageAcknowledgement,
} from '../../secrets/index.ts';
import type { EnsemblrDatabaseService } from '../../storage';

/**
 * Reads the keyring backend behind the secret store and whether the user has
 * already accepted it. The backend comes from `safeStorage` itself rather than
 * from the renderer, so a caller cannot claim acknowledgement of a backend the
 * session is not actually running under.
 * @param databaseService - Resolves the live database connection.
 * @returns The current obfuscated-storage status.
 */
function readObfuscatedStorageStatus(
	databaseService: EnsemblrDatabaseService,
): ObfuscatedStorageStatus {
	const database = databaseService.getConnection()?.database ?? null;
	const { backend } = readSafeStorageStatus();
	const isObfuscated = backend === OBFUSCATING_KEYRING_BACKEND;

	return {
		acknowledged:
			!isObfuscated || readObfuscatedStorageAcknowledgement(database, backend),
		backend,
		isObfuscated,
	};
}

/**
 * Registers the secrets IPC handlers: reading the keyring backend behind the
 * secret store and recording the user's acknowledgement that an obfuscating
 * backend only obfuscates rather than encrypts stored secrets.
 * @param options - Required services.
 */
export function registerSecretsHandlers({
	databaseService,
}: {
	databaseService: EnsemblrDatabaseService;
}): void {
	ipcMain.handle(
		IPC_CHANNELS.getObfuscatedStorageStatus,
		(): ObfuscatedStorageStatus => readObfuscatedStorageStatus(databaseService),
	);

	ipcMain.handle(
		IPC_CHANNELS.acknowledgeObfuscatedStorage,
		(): ObfuscatedStorageStatus => {
			const database = databaseService.getConnection()?.database ?? null;
			const { backend } = readSafeStorageStatus();

			if (database && backend === OBFUSCATING_KEYRING_BACKEND) {
				writeObfuscatedStorageAcknowledgement(database, backend);
			}

			return readObfuscatedStorageStatus(databaseService);
		},
	);
}
