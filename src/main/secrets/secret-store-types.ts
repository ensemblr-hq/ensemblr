import type { DatabaseSync } from 'node:sqlite';

/** Scope a secret is bound to: the whole app, a repository, or a workspace. */
export type SecretScope = 'app' | 'repository' | 'workspace';
/**
 * Storage backend a secret lives in: the macOS Keychain, Electron's
 * `safeStorage` (Linux), or the in-memory mock.
 */
export type SecretBackend = 'macos-keychain' | 'mock' | 'safe-storage';

/** Every backend that persists a metadata row, i.e. all but the mock. */
export type PersistedSecretBackend = Exclude<SecretBackend, 'mock'>;

/** Machine-readable failure categories for secret-store operations. */
export type SecretStoreErrorCode =
	| 'already-exists'
	| 'encryption-error'
	| 'invalid-input'
	| 'keychain-error'
	| 'metadata-error'
	| 'not-found'
	| 'unsupported-platform';

/** Identifies a secret entry by `(scope, scopeId, key)`. */
export interface SecretLookup {
	key: string;
	scope: SecretScope;
	scopeId?: string;
}

/** Secret write payload: identity plus value and optional metadata. */
export interface SecretWriteInput extends SecretLookup {
	displayName?: string;
	metadata?: Record<string, unknown>;
	value: string;
}

/** Persistable, non-sensitive view of a secret entry. */
export interface SecretMetadata {
	account: string;
	backend: SecretBackend;
	characterCount: number;
	createdAt: string;
	displayName: string;
	id: string;
	key: string;
	maskedDisplay: string;
	metadata: Record<string, unknown>;
	scope: SecretScope;
	scopeId: string;
	service: string;
	updatedAt: string;
}

/** Optional filter for {@link SecretStore.listMetadata}. */
export interface SecretMetadataFilter {
	scope?: SecretScope;
	scopeId?: string;
}

/** Public interface of every secret-store backend. */
export interface SecretStore {
	create: (input: SecretWriteInput) => Promise<SecretMetadata>;
	delete: (lookup: SecretLookup) => Promise<void>;
	listMetadata: (filter?: SecretMetadataFilter) => Promise<SecretMetadata[]>;
	maskSecret: (value: string) => string;
	read: (lookup: SecretLookup) => Promise<string | null>;
	update: (input: SecretWriteInput) => Promise<SecretMetadata>;
}

/** Options for the macOS Keychain backend. */
export interface MacosKeychainSecretStoreOptions {
	commandPath?: string;
	database: DatabaseSync;
	idFactory?: () => string;
	now?: () => Date;
	serviceName?: string;
}

/**
 * The slice of Electron's `safeStorage` the backend actually uses. Naming it
 * lets a test supply a fake, which the module-scope `electron` namespace import
 * otherwise makes impossible outside an Electron process.
 */
export type SafeStorageApi = Pick<
	Electron.SafeStorage,
	| 'decryptString'
	| 'encryptString'
	| 'getSelectedStorageBackend'
	| 'isEncryptionAvailable'
>;

/**
 * Options for the `safeStorage` backend. `serviceName` names no external store
 * — the ciphertext lives in SQLite — but it still identifies the row's
 * `(service, account)` pair, so a dev build can hold its own entries.
 */
export interface SafeStorageSecretStoreOptions {
	database: DatabaseSync;
	idFactory?: () => string;
	now?: () => Date;
	safeStorage?: SafeStorageApi;
	serviceName?: string;
}

/** Options for the mock backend. */
export interface MockSecretStoreOptions {
	idFactory?: () => string;
	now?: () => Date;
	serviceName?: string;
}

/** Internal: normalised secret lookup with non-optional `scopeId`. */
export interface NormalizedLookup {
	key: string;
	scope: SecretScope;
	scopeId: string;
}

/** Internal: normalised write input with defaults applied. */
export interface NormalizedWriteInput extends NormalizedLookup {
	displayName: string;
	metadata: Record<string, unknown>;
	value: string;
}

/** Internal: backend identity `(service, account)` pair. */
export interface KeychainReference {
	account: string;
	service: string;
}

export const SECRET_SCOPES: readonly SecretScope[] = [
	'app',
	'repository',
	'workspace',
];

/** Typed error thrown by every secret-store operation. */
export class SecretStoreError extends Error {
	readonly code: SecretStoreErrorCode;
	readonly command?: string;
	readonly exitCode?: number;
	readonly stderr?: string;

	/**
	 * @param code - Machine-readable failure category.
	 * @param message - Human-readable description.
	 * @param options - Optional command, exit code, stderr and cause for diagnostics.
	 */
	constructor(
		code: SecretStoreErrorCode,
		message: string,
		options: {
			cause?: unknown;
			command?: string;
			exitCode?: number;
			stderr?: string;
		} = {},
	) {
		super(message, { cause: options.cause });
		this.name = 'SecretStoreError';
		this.code = code;
		this.command = options.command;
		this.exitCode = options.exitCode;
		this.stderr = options.stderr;
	}
}
