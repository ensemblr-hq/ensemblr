import type { DatabaseSync } from 'node:sqlite';

import type { EnvironmentVariableDiagnostic, EnvironmentVariableScope, EnvironmentVariableSnapshot, EnvironmentVariablesSnapshot } from '../../shared/ipc/contracts/environment';
import type { EnsembleConfigService } from '../config/config-loader';
import type { SecretMetadata, SecretStore } from '../secrets/secret-store';
import {
	type EnsembleDatabaseService,
	requireDatabase,
} from '../storage/database.ts';
import {
	compareCatalogEntries,
	createCatalogMap,
	getCatalogEntryForKey,
} from './environment-variable-catalog.ts';
import {
	isEnvironmentVariableKey,
	isReservedEnvironmentVariableKey,
	isSecretEnvironmentVariableKey,
	toSecretStoreKey,
} from './environment-variable-keys.ts';
import { resolveEnvironmentVariables } from './environment-variable-resolution.ts';
import { createVariableSnapshots } from './environment-variable-snapshots.ts';
import type { NormalizedScope } from './environment-variable-types.ts';
import {
	deletePlainSetting,
	upsertPlainSetting,
} from './settings-repository.ts';

export { BUILT_IN_ENVIRONMENT_VARIABLE_CATALOG } from './environment-variable-catalog.ts';
export { isEnvironmentVariableKey } from './environment-variable-keys.ts';

export type EnvironmentVariablesErrorCode =
	| 'database-unavailable'
	| 'invalid-key'
	| 'invalid-scope'
	| 'reserved-key'
	| 'secret-store-unavailable'
	| 'secret-value-required';

/** Options for {@link EnvironmentVariablesService.getSnapshot}. */
export interface EnvironmentVariablesSnapshotOptions {
	requiredKeys?: readonly string[];
	scope?: EnvironmentVariableScope;
	scopeId?: string;
}

/** Input for plain/secret env-var write operations. */
export interface EnvironmentVariableWriteInput {
	key: string;
	scope?: EnvironmentVariableScope;
	scopeId?: string;
	value: string;
}

/** Input for env-var unset operations. */
export interface EnvironmentVariableUnsetInput {
	key: string;
	scope?: EnvironmentVariableScope;
	scopeId?: string;
}

/** Options for {@link EnvironmentVariablesService.assembleEnvironment}. */
export interface EnvironmentVariablesAssemblyOptions {
	includeSecrets?: boolean;
	requiredKeys?: readonly string[];
	scope?: EnvironmentVariableScope;
	scopeId?: string;
}

/** Assembled environment for command execution, plus advisory diagnostics. */
export interface EnvironmentVariablesAssembly {
	diagnostics: EnvironmentVariableDiagnostic[];
	env: Record<string, string>;
	redactValues: string[];
}

/** Public surface of the environment-variables service. */
export interface EnvironmentVariablesService {
	assembleEnvironment: (
		options?: EnvironmentVariablesAssemblyOptions,
	) => Promise<EnvironmentVariablesAssembly>;
	getSnapshot: (
		options?: EnvironmentVariablesSnapshotOptions,
	) => Promise<EnvironmentVariablesSnapshot>;
	setPlainValue: (
		input: EnvironmentVariableWriteInput,
	) => Promise<EnvironmentVariableSnapshot>;
	setSecretValue: (
		input: EnvironmentVariableWriteInput,
	) => Promise<EnvironmentVariableSnapshot>;
	unsetValue: (input: EnvironmentVariableUnsetInput) => Promise<void>;
}

/** Options for {@link createEnvironmentVariablesService}. */
export interface CreateEnvironmentVariablesServiceOptions {
	configService: EnsembleConfigService;
	database?: DatabaseSync | null;
	databaseService?: EnsembleDatabaseService;
	now?: () => Date;
	secretStore?: SecretStore;
	secretStoreFactory?: (database: DatabaseSync) => SecretStore | null;
}

/** Domain-specific error thrown by the environment-variables service. */
export class EnvironmentVariablesError extends Error {
	readonly code: EnvironmentVariablesErrorCode;

	/**
	 * @param code - Machine-readable failure category.
	 * @param message - Human-readable failure description.
	 */
	constructor(code: EnvironmentVariablesErrorCode, message: string) {
		super(message);
		this.name = 'EnvironmentVariablesError';
		this.code = code;
	}
}

/**
 * Builds the environment-variables service used by IPC handlers to read,
 * write, unset, and assemble env vars across app/repository/workspace scopes.
 * @param options - Service dependencies (config, database, secret store, clock).
 * @returns A fresh {@link EnvironmentVariablesService}.
 */
export function createEnvironmentVariablesService({
	configService,
	database = undefined,
	databaseService,
	now = () => new Date(),
	secretStore,
	secretStoreFactory = createDefaultSecretStore,
}: CreateEnvironmentVariablesServiceOptions): EnvironmentVariablesService {
	/** Resolves the active SQLite handle from the injected database or service. */
	function getDatabase(): DatabaseSync | null {
		if (database !== undefined) {
			return database;
		}

		return databaseService?.getConnection()?.database ?? null;
	}

	/**
	 * Resolves a secret store from explicit override, factory, or `null` when unavailable.
	 * @param databaseConnection - Active SQLite handle for factory creation.
	 * @returns A secret store, or `null`.
	 */
	function getSecretStore(
		databaseConnection: DatabaseSync | null,
	): SecretStore | null {
		if (secretStore) {
			return secretStore;
		}

		if (!databaseConnection) {
			return null;
		}

		return secretStoreFactory(databaseConnection);
	}

	/**
	 * Builds an IPC-safe snapshot of every env var visible at the requested scope.
	 * @param options - Optional scope and required-key filter.
	 * @returns A {@link EnvironmentVariablesSnapshot}.
	 */
	async function getSnapshot(
		options: EnvironmentVariablesSnapshotOptions = {},
	): Promise<EnvironmentVariablesSnapshot> {
		const databaseConnection = getDatabase();
		const state = await resolveEnvironmentVariables({
			configService,
			database: databaseConnection,
			now,
			requiredKeys: options.requiredKeys,
			scope: normalizeScope(options),
			secretStore: getSecretStore(databaseConnection),
		});
		const variables = createVariableSnapshots(state);

		return {
			catalog: Array.from(state.catalogByKey.values()).sort(
				compareCatalogEntries,
			),
			diagnostics: state.diagnostics,
			generatedAt: now().toISOString(),
			missingRequiredCount: variables.filter(
				(variable) => variable.required && variable.status === 'unset',
			).length,
			requiredCount: state.requiredKeys.size,
			variables,
		};
	}

	/**
	 * Materialises the effective `KEY=value` environment for command execution,
	 * resolving secrets when permitted and collecting required-variable diagnostics.
	 * @param options - Optional scope, required keys, and secret-inclusion flag.
	 * @returns The assembled env plus diagnostics and secret values to redact.
	 */
	async function assembleEnvironment(
		options: EnvironmentVariablesAssemblyOptions = {},
	): Promise<EnvironmentVariablesAssembly> {
		const databaseConnection = getDatabase();
		const state = await resolveEnvironmentVariables({
			configService,
			database: databaseConnection,
			now,
			requiredKeys: options.requiredKeys,
			scope: normalizeScope(options),
			secretStore: getSecretStore(databaseConnection),
		});
		const env: Record<string, string> = {};
		const redactValues: string[] = [];

		for (const [key, candidate] of state.plainValues) {
			if (isReservedEnvironmentVariableKey(key, state.catalogByKey)) {
				continue;
			}

			if (state.secretMetadata.has(key)) {
				continue;
			}

			env[key] = candidate.value;
		}

		if (options.includeSecrets ?? true) {
			if (!state.secretStore && state.secretMetadata.size > 0) {
				state.diagnostics.push({
					code: 'secret-store-unavailable',
					message:
						'Secret metadata exists, but the secret store is unavailable.',
					severity: 'warning',
				});
			}

			if (state.secretStore) {
				for (const [key, metadata] of state.secretMetadata) {
					if (isReservedEnvironmentVariableKey(key, state.catalogByKey)) {
						continue;
					}

					const value = await state.secretStore.read({
						key: metadata.key,
						scope: metadata.scope,
						scopeId: metadata.scopeId || undefined,
					});

					if (value === null) {
						state.diagnostics.push({
							code: 'secret-value-missing',
							key,
							message:
								'Secret metadata exists, but the secret value was not found.',
							severity: 'warning',
						});
						continue;
					}

					env[key] = value;
					redactValues.push(value);
				}
			}
		}

		for (const requiredKey of state.requiredKeys) {
			if (!env[requiredKey]) {
				state.diagnostics.push({
					code: 'required-variable-missing',
					key: requiredKey,
					message: `${requiredKey} is required but unset.`,
					severity: 'error',
				});
			}
		}

		return {
			diagnostics: state.diagnostics,
			env,
			redactValues,
		};
	}

	/**
	 * Persists a plain-string env var to SQLite, rejecting reserved or
	 * secret-classified keys and removing any conflicting secret-store entry.
	 * @param input - Key, scope, and value.
	 * @returns The resulting variable snapshot.
	 */
	async function setPlainValue(
		input: EnvironmentVariableWriteInput,
	): Promise<EnvironmentVariableSnapshot> {
		const key = normalizeEnvironmentVariableKey(input.key);
		const scope = normalizeScope(input);
		const catalogByKey = createCatalogMap();

		if (isReservedEnvironmentVariableKey(key, catalogByKey)) {
			throw new EnvironmentVariablesError(
				'reserved-key',
				`${key} is reserved for runtime environment injection.`,
			);
		}

		if (isSecretEnvironmentVariableKey(key, catalogByKey)) {
			throw new EnvironmentVariablesError(
				'secret-value-required',
				`${key} is classified as secret and must be stored through the secret store.`,
			);
		}

		const databaseConnection = requireEnvironmentDatabase(getDatabase());
		const store = getSecretStore(databaseConnection);

		upsertPlainSetting({
			database: databaseConnection,
			key,
			scope,
			value: input.value,
		});

		if (store) {
			await store.delete({
				key: toSecretStoreKey(key),
				scope: scope.scope,
				scopeId: scope.scopeId || undefined,
			});
		}

		return {
			catalog: getCatalogEntryForKey(key, catalogByKey),
			displayValue: input.value,
			key,
			required: false,
			scope: scope.scope,
			scopeId: scope.scopeId,
			source: 'sqlite',
			status: 'set',
			valueKind: 'plain',
		};
	}

	/**
	 * Persists a secret env var to the secret store, removing any conflicting
	 * plain SQLite entry.
	 * @param input - Key, scope, and value.
	 * @returns The resulting variable snapshot (masked).
	 */
	async function setSecretValue(
		input: EnvironmentVariableWriteInput,
	): Promise<EnvironmentVariableSnapshot> {
		const key = normalizeEnvironmentVariableKey(input.key);
		const scope = normalizeScope(input);
		const catalogByKey = createCatalogMap();

		if (isReservedEnvironmentVariableKey(key, catalogByKey)) {
			throw new EnvironmentVariablesError(
				'reserved-key',
				`${key} is reserved for runtime environment injection.`,
			);
		}

		const databaseConnection = requireEnvironmentDatabase(getDatabase());
		const store = requireSecretStore(getSecretStore(databaseConnection));

		const metadataInput = {
			displayName: `${key} environment variable`,
			key: toSecretStoreKey(key),
			metadata: {
				kind: 'environment-variable',
				variableKey: key,
			},
			scope: scope.scope,
			scopeId: scope.scopeId || undefined,
			value: input.value,
		};
		let metadata: SecretMetadata;

		try {
			metadata = await store.create(metadataInput);
		} catch (error) {
			if (isSecretStoreAlreadyExistsError(error)) {
				metadata = await store.update(metadataInput);
			} else {
				throw error;
			}
		}

		deletePlainSetting({
			database: databaseConnection,
			key,
			scope,
		});

		const catalog = {
			...getCatalogEntryForKey(key, catalogByKey),
			valueKind: 'secret' as const,
		};

		return {
			catalog,
			characterCount: metadata.characterCount,
			key,
			maskedDisplay: metadata.maskedDisplay,
			required: false,
			scope: metadata.scope,
			scopeId: metadata.scopeId,
			source: 'secret-metadata',
			status: 'masked',
			valueKind: 'secret',
		};
	}

	/**
	 * Removes the env var from both SQLite and the secret store, if present.
	 * @param input - Key and scope to clear.
	 */
	async function unsetValue(
		input: EnvironmentVariableUnsetInput,
	): Promise<void> {
		const databaseConnection = getDatabase();
		const key = normalizeEnvironmentVariableKey(input.key);
		const scope = normalizeScope(input);

		if (databaseConnection) {
			deletePlainSetting({
				database: databaseConnection,
				key,
				scope,
			});
		}

		const store = getSecretStore(databaseConnection);

		if (store) {
			await store.delete({
				key: toSecretStoreKey(key),
				scope: scope.scope,
				scopeId: scope.scopeId || undefined,
			});
		}
	}

	return {
		assembleEnvironment,
		getSnapshot,
		setPlainValue,
		setSecretValue,
		unsetValue,
	};
}

/**
 * Trims and validates a write-operation key, throwing on invalid input.
 * @param key - Caller-supplied key.
 * @returns The trimmed key.
 */
function normalizeEnvironmentVariableKey(key: string): string {
	const normalized = key.trim();

	if (!isEnvironmentVariableKey(normalized)) {
		throw new EnvironmentVariablesError(
			'invalid-key',
			`"${key}" is not a valid environment variable name.`,
		);
	}

	return normalized;
}

/**
 * Coerces caller-supplied scope/scopeId into a normalised pair, requiring a
 * non-empty `scopeId` for non-app scopes.
 * @param input - Scope and optional scope id.
 * @returns The normalised pair.
 */
function normalizeScope({
	scope = 'app',
	scopeId,
}: {
	scope?: EnvironmentVariableScope;
	scopeId?: string;
}): NormalizedScope {
	if (scope !== 'app' && scope !== 'repository' && scope !== 'workspace') {
		throw new EnvironmentVariablesError(
			'invalid-scope',
			`Unsupported environment variable scope: ${String(scope)}.`,
		);
	}

	const normalizedScopeId = scope === 'app' ? '' : (scopeId ?? '').trim();

	if (scope !== 'app' && !normalizedScopeId) {
		throw new EnvironmentVariablesError(
			'invalid-scope',
			`scopeId is required for ${scope} environment variables.`,
		);
	}

	return {
		scope,
		scopeId: normalizedScopeId,
	};
}

/**
 * Asserts a database handle is available, throwing a typed error otherwise.
 * @param database - Candidate database handle.
 * @returns The handle.
 */
function requireEnvironmentDatabase(
	database: DatabaseSync | null,
): DatabaseSync {
	return requireDatabase(
		database,
		() =>
			new EnvironmentVariablesError(
				'database-unavailable',
				'SQLite is unavailable; the environment variable was not saved.',
			),
	);
}

/**
 * Asserts a secret store is available, throwing a typed error otherwise.
 * @param secretStore - Candidate store.
 * @returns The store.
 */
function requireSecretStore(secretStore: SecretStore | null): SecretStore {
	if (!secretStore) {
		throw new EnvironmentVariablesError(
			'secret-store-unavailable',
			'The secret store is unavailable; the environment variable was not saved.',
		);
	}

	return secretStore;
}

/**
 * Default factory that yields no secret store; callers wire a platform-specific
 * store at service construction time.
 * @returns Always `null`.
 */
function createDefaultSecretStore(_database: DatabaseSync): SecretStore | null {
	return null;
}

/**
 * Type guard for the secret-store "already exists" error shape.
 * @param error - Thrown value.
 * @returns True when the error indicates an existing entry.
 */
function isSecretStoreAlreadyExistsError(
	error: unknown,
): error is { code: 'already-exists' } {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		error.code === 'already-exists'
	);
}
