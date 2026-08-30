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
	type SafeStorageSecretStoreOptions,
	type SecretStore,
	SecretStoreError,
} from './secret-store-types.ts';
import {
	createSqliteSecretMetadataStore,
	type MetadataStore,
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
 * @param options - Database handle plus optional clock, id factory and service name.
 * @returns A {@link SecretStore} whose values are encrypted by the OS keyring.
 */
export function createSafeStorageSecretStore({
	database,
	idFactory = randomUUID,
	now = () => new Date(),
	serviceName = DEFAULT_SAFE_STORAGE_SERVICE_NAME,
}: SafeStorageSecretStoreOptions): SecretStore {
	return buildSafeStorageSecretStore({
		idFactory,
		metadataStore: createSqliteSecretMetadataStore(database),
		now,
		serviceName,
	});
}

/** Injected dependencies for {@link buildSafeStorageSecretStore}. */
interface SafeStorageBackendDependencies {
	idFactory: () => string;
	metadataStore: MetadataStore;
	now: () => Date;
	serviceName: string;
}

/**
 * Composes a {@link SecretStore} from an injected {@link MetadataStore}, so the
 * encryption plumbing stays separate from where the row is persisted.
 */
function buildSafeStorageSecretStore({
	idFactory,
	metadataStore,
	now,
	serviceName,
}: SafeStorageBackendDependencies): SecretStore {
	/**
	 * Builds the row payload shared by insert and update, encrypting the value.
	 * @param input - Normalised write input.
	 * @returns The persist payload minus the fields only one caller supplies.
	 */
	function toPersistPayload(input: NormalizedWriteInput) {
		return {
			...input,
			backend: 'safe-storage' as const,
			maskedDisplay: maskSecret(input.value),
			now: now().toISOString(),
			secretValue: encryptSecret(input.value),
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
			const ciphertext = metadataStore.readSecretValue(normalized);

			if (!ciphertext) {
				return null;
			}

			return decryptSecret(ciphertext, normalized.key);
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
 * Resolves Electron's `safeStorage`, refusing when the runtime does not offer
 * one — a plain Node process running the test suites, most often.
 * @param action - What the caller was about to do, named in the error.
 * @returns The `safeStorage` module.
 */
function requireSafeStorage(action: 'read' | 'store'): Electron.SafeStorage {
	const safeStorage = electron.safeStorage as Electron.SafeStorage | undefined;

	if (!safeStorage?.isEncryptionAvailable()) {
		throw new SecretStoreError(
			'encryption-error',
			`The OS keyring reported no encryption backend, so secrets cannot be ${action === 'store' ? 'stored' : 'read'}.`,
		);
	}

	return safeStorage;
}

/**
 * Encrypts a secret value with the session's keyring.
 * @param value - Plaintext secret value.
 * @returns The opaque ciphertext to persist.
 */
function encryptSecret(value: string): Uint8Array {
	const safeStorage = requireSafeStorage('store');

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
 * @param ciphertext - Bytes previously produced by {@link encryptSecret}.
 * @param key - Secret key, named in the error so a failure is traceable.
 * @returns The plaintext secret value.
 */
function decryptSecret(ciphertext: Uint8Array, key: string): string {
	const safeStorage = requireSafeStorage('read');

	try {
		return safeStorage.decryptString(Buffer.from(ciphertext));
	} catch (error) {
		throw new SecretStoreError(
			'encryption-error',
			`The stored value for ${key} could not be decrypted. The OS keyring backend may have changed since it was saved.`,
			{ cause: error },
		);
	}
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
