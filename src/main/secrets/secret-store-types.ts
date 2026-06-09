import type { DatabaseSync } from 'node:sqlite';

export type SecretScope = 'app' | 'repository' | 'workspace';
export type SecretBackend = 'macos-keychain' | 'mock';

export type SecretStoreErrorCode =
	| 'already-exists'
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

/** Internal: Keychain identity `(service, account)` pair. */
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
