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

/**
 * Grades one of Electron's storage-backend ids.
 *
 * `basic_text` obfuscates with a hardcoded key rather than encrypting, and
 * `unknown` means Electron could not identify the password store — the check
 * exists to warn, so an unidentified backend is graded down rather than
 * assumed safe.
 * @param backend - Backend id from `getSelectedStorageBackend()`.
 * @returns How much protection that backend provides.
 */
function gradeBackend(
	backend: ReturnType<Electron.SafeStorage['getSelectedStorageBackend']>,
): SafeStorageProtection {
	switch (backend) {
		case 'gnome_libsecret':
		case 'kwallet':
		case 'kwallet5':
		case 'kwallet6':
			return 'encrypted';
		case 'basic_text':
		case 'unknown':
			return 'obfuscated';
		default: {
			const exhaustive: never = backend;
			return exhaustive;
		}
	}
}

/**
 * Probes Electron's `safeStorage` for the backend it selected and how much
 * protection that backend actually provides.
 *
 * Only Linux reports a backend id — `getSelectedStorageBackend()` is a Linux
 * API. Callers gate this check to Linux declaratively via
 * `PLATFORM_ONLY_CHECK_IDS`, so it never has a platform to branch on here.
 * @returns The keyring status behind the Linux secret store.
 */
export function readSafeStorageStatus(): SafeStorageStatus {
	const safeStorage = electron.safeStorage as Electron.SafeStorage | undefined;

	if (!safeStorage?.isEncryptionAvailable()) {
		return { backend: 'unavailable', protection: 'unavailable' };
	}

	const backend = safeStorage.getSelectedStorageBackend();

	return { backend, protection: gradeBackend(backend) };
}
