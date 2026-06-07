import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
	EnvironmentVariableDiagnostic,
	EnvironmentVariableScope,
	EnvironmentVariableSnapshot,
	EnvironmentVariablesSnapshot,
} from '../../shared/ipc';
import type { EnsembleConfigService } from '../config/config-loader';
import type { SecretMetadata, SecretStore } from '../secrets/secret-store';
import type { EnsembleDatabaseService } from '../storage/database';
import {
	compareCatalogEntries,
	createCatalogMap,
	createCustomCatalogEntry,
	getCatalogEntryForKey,
} from './environment-variable-catalog.ts';
import {
	collectConfigDefaults,
	collectSecretMetadata,
	collectSqlitePlainValues,
} from './environment-variable-collectors.ts';
import {
	isEnvironmentVariableKey,
	isReservedEnvironmentVariableKey,
	isSecretEnvironmentVariableKey,
	toSecretStoreKey,
	toSettingKey,
} from './environment-variable-keys.ts';
import { createVariableSnapshots } from './environment-variable-snapshots.ts';
import type {
	EnvironmentState,
	NormalizedScope,
	PlainValueCandidate,
} from './environment-variable-types.ts';

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
		const state = await collectEnvironmentState({
			configService,
			database: getDatabase(),
			now,
			options,
			secretStore: getSecretStore(getDatabase()),
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
		const state = await collectEnvironmentState({
			configService,
			database: databaseConnection,
			now,
			options,
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

		const databaseConnection = requireDatabase(getDatabase());
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

		const databaseConnection = requireDatabase(getDatabase());
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
 * Collects every input the snapshot/assembly renderers need (config defaults,
 * SQLite rows, secret metadata, catalog) for the requested scope.
 * @param input - Service dependencies and request options.
 * @returns The merged environment state.
 */
async function collectEnvironmentState({
	configService,
	database,
	now: _now,
	options,
	secretStore,
}: {
	configService: EnsembleConfigService;
	database: DatabaseSync | null;
	now: () => Date;
	options:
		| EnvironmentVariablesSnapshotOptions
		| EnvironmentVariablesAssemblyOptions;
	secretStore: SecretStore | null;
}): Promise<EnvironmentState> {
	const scope = normalizeScope(options);
	const diagnostics: EnvironmentVariableDiagnostic[] = [];
	const invalidKeys = new Set<string>();
	const catalogByKey = createCatalogMap();
	const requiredKeys = normalizeRequiredKeys(options.requiredKeys, diagnostics);

	for (const requiredKey of requiredKeys) {
		if (!catalogByKey.has(requiredKey)) {
			catalogByKey.set(requiredKey, createCustomCatalogEntry(requiredKey));
		}
	}

	const plainValues = new Map<string, PlainValueCandidate>();

	if (scope.scope === 'app') {
		for (const [key, candidate] of collectConfigDefaults({
			catalogByKey,
			configEnvironment: configService.getConfig().environment,
			diagnostics,
			invalidKeys,
		})) {
			plainValues.set(key, candidate);
		}
	}

	if (database) {
		for (const [key, candidate] of collectSqlitePlainValues({
			database,
			diagnostics,
			invalidKeys,
			scope,
		})) {
			plainValues.set(key, candidate);

			if (!catalogByKey.has(key)) {
				catalogByKey.set(key, createCustomCatalogEntry(key));
			}
		}
	}

	const secretMetadata = await collectSecretMetadata({
		diagnostics,
		scope,
		secretStore,
	});

	for (const key of secretMetadata.keys()) {
		if (!catalogByKey.has(key)) {
			catalogByKey.set(key, {
				...createCustomCatalogEntry(key),
				valueKind: 'secret',
			});
		}
	}

	return {
		catalogByKey,
		diagnostics,
		invalidKeys,
		plainValues,
		requiredKeys,
		scope,
		secretMetadata,
		secretStore,
	};
}

/**
 * Validates and de-duplicates the caller-supplied required-key list, emitting
 * diagnostics for malformed keys.
 * @param requiredKeys - Caller list.
 * @param diagnostics - Diagnostic sink.
 * @returns A clean set of valid required keys.
 */
function normalizeRequiredKeys(
	requiredKeys: readonly string[] | undefined,
	diagnostics: EnvironmentVariableDiagnostic[],
): Set<string> {
	const normalizedKeys = new Set<string>();

	for (const key of requiredKeys ?? []) {
		const normalized = typeof key === 'string' ? key.trim() : '';

		if (!isEnvironmentVariableKey(normalized)) {
			diagnostics.push({
				code: 'invalid-required-variable-key',
				key: normalized || undefined,
				message: `Required environment variable key "${String(key)}" is invalid.`,
				severity: 'error',
			});
			continue;
		}

		normalizedKeys.add(normalized);
	}

	return normalizedKeys;
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
 * Inserts or updates a plain env var row in the SQLite `settings` table.
 * @param input - Database, key, scope, and string value.
 */
function upsertPlainSetting({
	database,
	key,
	scope,
	value,
}: {
	database: DatabaseSync;
	key: string;
	scope: NormalizedScope;
	value: string;
}): void {
	const timestamp = new Date().toISOString();

	database
		.prepare(
			`INSERT INTO settings (
				id,
				scope,
				scope_id,
				key,
				value_json,
				source,
				locked,
				updated_at
			)
			VALUES (?, ?, ?, ?, ?, 'sqlite', 0, ?)
			ON CONFLICT(scope, scope_id, key) DO UPDATE SET
				value_json = excluded.value_json,
				source = 'sqlite',
				locked = 0,
				updated_at = excluded.updated_at`,
		)
		.run(
			`setting-${randomUUID()}`,
			scope.scope,
			scope.scopeId,
			toSettingKey(key),
			JSON.stringify(value),
			timestamp,
		);
}

/**
 * Removes the plain env var row from the SQLite `settings` table, if any.
 * @param input - Database, key, and scope.
 */
function deletePlainSetting({
	database,
	key,
	scope,
}: {
	database: DatabaseSync;
	key: string;
	scope: NormalizedScope;
}): void {
	database
		.prepare(
			`DELETE FROM settings
			 WHERE scope = ? AND scope_id = ? AND key = ?`,
		)
		.run(scope.scope, scope.scopeId, toSettingKey(key));
}

/**
 * Asserts a database handle is available, throwing a typed error otherwise.
 * @param database - Candidate database handle.
 * @returns The handle.
 */
function requireDatabase(database: DatabaseSync | null): DatabaseSync {
	if (!database) {
		throw new EnvironmentVariablesError(
			'database-unavailable',
			'SQLite is unavailable; the environment variable was not saved.',
		);
	}

	return database;
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
