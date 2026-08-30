import { randomUUID } from 'node:crypto';
// Namespace import, not `import { safeStorage }`: under `ELECTRON_RUN_AS_NODE`
// the `electron` module is a path string with no such export, and a named
// import fails at link time — before any test can decide it never calls this.
import * as electron from 'electron';

import {
	createKeychainReference,
	formatLookup,
	maskSecret,
	normalizeFilter,
	normalizeLookup,
	normalizeWriteInput,
} from './normalize.ts';
import {
	type NormalizedWriteInput,
	type SafeStorageApi,
	type SafeStorageSecretStoreOptions,
	type SecretStore,
	SecretStoreError,
} from './secret-store-types.ts';
import {
	createSqliteSecretMetadataStore,
	type MetadataStore,
	type StoredCiphertext,
} from './sqlite-metadata-store.ts';

const DEFAULT_SAFE_STORAGE_SERVICE_NAME = 'dev.ensemblr.app.secret-store';

/**
 * Builds a secret store backed by Electron's `safeStorage`, keeping the
 * ciphertext in the same SQLite row as the entry's metadata.
 *
 * Linux has no Keychain equivalent Ensemblr can shell out to, and `safeStorage`
 * already wraps whatever keyring the session provides (gnome-libsecret,
 * KWallet) behind one API. It hands back opaque bytes with nowhere to store
 * them, which is why the row carries them.
 * @param options - Database handle plus optional clock, id factory, service name and `safeStorage`.
 * @returns A {@link SecretStore} whose values are encrypted by the OS keyring.
 */
export function createSafeStorageSecretStore({
	database,
	idFactory = randomUUID,
	now = () => new Date(),
	safeStorage,
	serviceName = DEFAULT_SAFE_STORAGE_SERVICE_NAME,
}: SafeStorageSecretStoreOptions): SecretStore {
	return buildSafeStorageSecretStore({
		idFactory,
		metadataStore: createSqliteSecretMetadataStore(database),
		now,
		resolveSafeStorage: safeStorage
			? () => safeStorage
			: resolveElectronSafeStorage,
		serviceName,
	});
}

/** Injected dependencies for {@link buildSafeStorageSecretStore}. */
export interface SafeStorageBackendDependencies {
	idFactory: () => string;
	metadataStore: MetadataStore;
	now: () => Date;
	resolveSafeStorage: () => SafeStorageApi | undefined;
	serviceName: string;
}

/**
 * Composes a {@link SecretStore} from an injected {@link MetadataStore} and
 * `safeStorage`, so the encryption plumbing stays separate from where the row is
 * persisted — and so both can be driven from a test outside Electron.
 * @param dependencies - Metadata store, keyring resolver, clock, id factory and service name.
 * @returns A {@link SecretStore} over the injected pieces.
 */
export function buildSafeStorageSecretStore({
	idFactory,
	metadataStore,
	now,
	resolveSafeStorage,
	serviceName,
}: SafeStorageBackendDependencies): SecretStore {
	/**
	 * Builds the row payload shared by insert and update, encrypting the value.
	 * @param input - Normalised write input.
	 * @returns The persist payload minus the fields only one caller supplies.
	 */
	function toPersistPayload(input: NormalizedWriteInput) {
		const safeStorage = requireSafeStorage(resolveSafeStorage, 'store');

		return {
			...input,
			backend: 'safe-storage' as const,
			keyringBackend: readKeyringBackend(safeStorage),
			maskedDisplay: maskSecret(input.value),
			now: now().toISOString(),
			secretValue: encryptSecret(safeStorage, input.value),
		};
	}

	return {
		async create(input) {
			const normalized = normalizeWriteInput(input);

			if (metadataStore.get(normalized)) {
				throw new SecretStoreError(
					'already-exists',
					`A secret metadata entry already exists for ${formatLookup(normalized)}.`,
				);
			}

			const reference = createKeychainReference(serviceName, normalized);

			try {
				return metadataStore.insert({
					...toPersistPayload(normalized),
					...reference,
					id: idFactory(),
				});
			} catch (error) {
				throw toMetadataError(error);
			}
		},
		async delete(lookup) {
			metadataStore.delete(normalizeLookup(lookup));
		},
		async listMetadata(filter) {
			return metadataStore.list(normalizeFilter(filter));
		},
		maskSecret,
		async read(lookup) {
			const normalized = normalizeLookup(lookup);
			const stored = metadataStore.readSecretValue(normalized);

			if (!stored) {
				return null;
			}

			const safeStorage = requireSafeStorage(resolveSafeStorage, 'read');

			return decryptSecret(safeStorage, stored, normalized.key);
		},
		async update(input) {
			const normalized = normalizeWriteInput(input);
			const existing = metadataStore.get(normalized);

			if (!existing) {
				throw new SecretStoreError(
					'not-found',
					`No secret metadata entry exists for ${formatLookup(normalized)}.`,
				);
			}

			try {
				return metadataStore.update({
					...toPersistPayload(normalized),
					account: existing.account,
					id: existing.id,
					service: existing.service,
				});
			} catch (error) {
				throw toMetadataError(error);
			}
		},
	};
}

/**
 * Reads Electron's own `safeStorage`, which is absent under
 * `ELECTRON_RUN_AS_NODE` and in a plain Node process.
 * @returns The `safeStorage` module, or undefined outside Electron.
 */
function resolveElectronSafeStorage(): SafeStorageApi | undefined {
	return electron.safeStorage as SafeStorageApi | undefined;
}

/**
 * Resolves the keyring, refusing when the runtime does not offer one.
 * @param resolve - Supplies the keyring API.
 * @param action - What the caller was about to do, named in the error.
 * @returns The resolved keyring API.
 */
function requireSafeStorage(
	resolve: () => SafeStorageApi | undefined,
	action: 'read' | 'store',
): SafeStorageApi {
	const safeStorage = resolve();

	if (!safeStorage?.isEncryptionAvailable()) {
		throw new SecretStoreError(
			'encryption-error',
			`The OS keyring reported no encryption backend, so secrets cannot be ${action === 'store' ? 'stored' : 'read'}.`,
		);
	}

	return safeStorage;
}

/**
 * Names the keyring that is about to encrypt a value, so a later decrypt
 * failure can say whether the session's backend changed.
 * @param safeStorage - Resolved keyring API.
 * @returns The backend id, or `unknown` off Linux where Electron reports none.
 */
function readKeyringBackend(safeStorage: SafeStorageApi): string {
	return process.platform === 'linux'
		? safeStorage.getSelectedStorageBackend()
		: 'unknown';
}

/**
 * Encrypts a secret value with the session's keyring.
 * @param safeStorage - Resolved keyring API.
 * @param value - Plaintext secret value.
 * @returns The opaque ciphertext to persist.
 */
function encryptSecret(safeStorage: SafeStorageApi, value: string): Uint8Array {
	try {
		return safeStorage.encryptString(value);
	} catch (error) {
		throw new SecretStoreError(
			'encryption-error',
			'The OS keyring failed to encrypt the secret value.',
			{ cause: error },
		);
	}
}

/**
 * Decrypts a stored ciphertext back into its secret value.
 * @param safeStorage - Resolved keyring API.
 * @param stored - Ciphertext plus the keyring backend that produced it.
 * @param key - Secret key, named in the error so a failure is traceable.
 * @returns The plaintext secret value.
 */
function decryptSecret(
	safeStorage: SafeStorageApi,
	stored: StoredCiphertext,
	key: string,
): string {
	try {
		return safeStorage.decryptString(Buffer.from(stored.ciphertext));
	} catch (error) {
		throw new SecretStoreError(
			'encryption-error',
			describeDecryptFailure(safeStorage, stored, key),
			{ cause: error },
		);
	}
}

/**
 * Explains a failed decrypt, naming the keyring change when the row records a
 * different backend than the session now reports.
 * @param safeStorage - Resolved keyring API.
 * @param stored - Ciphertext plus the keyring backend that produced it.
 * @param key - Secret key, named so a failure is traceable.
 * @returns The message to surface.
 */
function describeDecryptFailure(
	safeStorage: SafeStorageApi,
	stored: StoredCiphertext,
	key: string,
): string {
	const current = readKeyringBackend(safeStorage);

	if (stored.keyringBackend && stored.keyringBackend !== current) {
		return `The stored value for ${key} was encrypted by the ${stored.keyringBackend} keyring, but this session uses ${current}. Re-enter the secret to store it under the current keyring.`;
	}

	return `The stored value for ${key} could not be decrypted.`;
}

/**
 * Wraps an unknown error as a `metadata-error` unless it is already typed.
 * @param error - Thrown value.
 * @returns A typed error.
 */
function toMetadataError(error: unknown): SecretStoreError {
	if (error instanceof SecretStoreError) {
		return error;
	}

	return new SecretStoreError(
		'metadata-error',
		'Failed to persist secret metadata.',
		{ cause: error },
	);
}
