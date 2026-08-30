// Namespace import, not `import { safeStorage }`: under `ELECTRON_RUN_AS_NODE`
// the `electron` module is a path string with no such export, and a named
// import fails at link time.
import * as electron from 'electron';

/**
 * How well the session's keyring protects a stored secret.
 *
 * `encrypted` is the intended state. `obfuscated` is what Electron falls back
 * to when no keyring daemon answers: `safeStorage` still round-trips a value,
 * but with a hardcoded key, so the ciphertext is reversible by anyone who can
 * read the database. `unavailable` means it will not round-trip at all.
 */
export type SafeStorageProtection = 'encrypted' | 'obfuscated' | 'unavailable';

/** What the session's keyring reports about itself. */
export interface SafeStorageStatus {
	/** Electron's backend id, e.g. `kwallet6`, `gnome_libsecret`, `basic_text`. */
	backend: string;
	protection: SafeStorageProtection;
}

const PLAINTEXT_BACKEND = 'basic_text';

/**
 * Probes Electron's `safeStorage` for the backend it selected and how much
 * protection that backend actually provides.
 * @returns The keyring status behind the Linux secret store.
 */
export function readSafeStorageStatus(): SafeStorageStatus {
	const safeStorage = electron.safeStorage as Electron.SafeStorage | undefined;

	if (!safeStorage?.isEncryptionAvailable()) {
		return { backend: 'unavailable', protection: 'unavailable' };
	}

	const backend =
		process.platform === 'linux'
			? safeStorage.getSelectedStorageBackend()
			: process.platform;

	return {
		backend,
		protection: backend === PLAINTEXT_BACKEND ? 'obfuscated' : 'encrypted',
	};
}
