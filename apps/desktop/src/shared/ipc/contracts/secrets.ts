/**
 * Refusal reported when a secret write would only be obfuscated by the
 * session's keyring backend, and the user has not accepted that.
 */
export type ObfuscatedStorageFailureCode = 'obfuscated-storage-unacknowledged';

/**
 * Snapshot of the keyring backend behind the secret store and whether the
 * user has accepted that this exact backend only obfuscates stored secrets
 * rather than encrypting them.
 */
export interface ObfuscatedStorageStatus {
	/** True when the user already accepted `backend`. Always true when `isObfuscated` is false. */
	acknowledged: boolean;
	/** Electron's backend id behind the secret store, e.g. `basic_text`, `gnome_libsecret`, `kwallet6`. */
	backend: string;
	/** True when `backend` only obfuscates ciphertext with a hardcoded key rather than encrypting it. */
	isObfuscated: boolean;
}

/**
 * Secrets IPC surface: reads the keyring backend behind the secret store and
 * records the user's acknowledgement that an obfuscating backend only
 * obfuscates rather than encrypts.
 */
export interface SecretsApi {
	acknowledgeObfuscatedStorage: () => Promise<ObfuscatedStorageStatus>;
	getObfuscatedStorageStatus: () => Promise<ObfuscatedStorageStatus>;
}
