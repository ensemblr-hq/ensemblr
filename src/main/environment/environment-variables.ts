import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
	EnvironmentVariableCatalogEntrySnapshot,
	EnvironmentVariableCategory,
	EnvironmentVariableDiagnostic,
	EnvironmentVariableScope,
	EnvironmentVariableSnapshot,
	EnvironmentVariablesSnapshot,
	EnvironmentVariableValueKind,
	SettingsResolutionSource,
} from '../../shared/ipc';
import type { EnsembleConfigService } from '../config/config-loader';
import type { SecretMetadata, SecretStore } from '../secrets/secret-store';
import type { EnsembleDatabaseService } from '../storage/database';

export type EnvironmentVariablesErrorCode =
	| 'database-unavailable'
	| 'invalid-key'
	| 'invalid-scope'
	| 'reserved-key'
	| 'secret-store-unavailable'
	| 'secret-value-required';

export interface EnvironmentVariablesSnapshotOptions {
	requiredKeys?: readonly string[];
	scope?: EnvironmentVariableScope;
	scopeId?: string;
}

export interface EnvironmentVariableWriteInput {
	key: string;
	scope?: EnvironmentVariableScope;
	scopeId?: string;
	value: string;
}

export interface EnvironmentVariableUnsetInput {
	key: string;
	scope?: EnvironmentVariableScope;
	scopeId?: string;
}

export interface EnvironmentVariablesAssemblyOptions {
	includeSecrets?: boolean;
	requiredKeys?: readonly string[];
	scope?: EnvironmentVariableScope;
	scopeId?: string;
}

export interface EnvironmentVariablesAssembly {
	diagnostics: EnvironmentVariableDiagnostic[];
	env: Record<string, string>;
	redactValues: string[];
}

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

export interface CreateEnvironmentVariablesServiceOptions {
	configService: EnsembleConfigService;
	database?: DatabaseSync | null;
	databaseService?: EnsembleDatabaseService;
	now?: () => Date;
	secretStore?: SecretStore;
	secretStoreFactory?: (database: DatabaseSync) => SecretStore | null;
}

interface NormalizedScope {
	scope: EnvironmentVariableScope;
	scopeId: string;
}

interface PlainValueCandidate {
	source: Extract<SettingsResolutionSource, 'config-default' | 'sqlite'>;
	value: string;
}

interface SqliteEnvironmentRow {
	key: string;
	value_json: string;
}

interface EnvironmentState {
	catalogByKey: Map<string, EnvironmentVariableCatalogEntrySnapshot>;
	diagnostics: EnvironmentVariableDiagnostic[];
	invalidKeys: Set<string>;
	plainValues: Map<string, PlainValueCandidate>;
	requiredKeys: Set<string>;
	scope: NormalizedScope;
	secretMetadata: Map<string, SecretMetadata>;
	secretStore: SecretStore | null;
}

const ENVIRONMENT_SETTING_PREFIX = 'environment.variables.';
const SECRET_ENVIRONMENT_KEY_PREFIX = 'environment:variables:';
const ENVIRONMENT_VARIABLE_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REDACTED_DISPLAY_VALUE = '[set]';
const SENSITIVE_KEY_PARTS = [
	'accesstoken',
	'apikey',
	'auth',
	'credential',
	'password',
	'privatekey',
	'secret',
	'token',
];

export const BUILT_IN_ENVIRONMENT_VARIABLE_CATALOG: readonly EnvironmentVariableCatalogEntrySnapshot[] =
	[
		{
			category: 'pi',
			description:
				'Optional Pi agent directory override. Leave unset to preserve the normal Pi user environment.',
			key: 'PI_CODING_AGENT_DIR',
			required: false,
			reserved: false,
			scope: 'app',
			title: 'Pi agent directory',
			valueKind: 'plain',
		},
		{
			category: 'proxy',
			description:
				'HTTP proxy used by tools that honor standard proxy environment variables.',
			key: 'HTTP_PROXY',
			required: false,
			reserved: false,
			scope: 'app',
			title: 'HTTP proxy',
			valueKind: 'secret',
		},
		{
			category: 'proxy',
			description:
				'HTTPS proxy used by tools that honor standard proxy environment variables.',
			key: 'HTTPS_PROXY',
			required: false,
			reserved: false,
			scope: 'app',
			title: 'HTTPS proxy',
			valueKind: 'secret',
		},
		{
			category: 'proxy',
			description: 'Fallback proxy used by tools that support ALL_PROXY.',
			key: 'ALL_PROXY',
			required: false,
			reserved: false,
			scope: 'app',
			title: 'All-protocol proxy',
			valueKind: 'secret',
		},
		{
			category: 'proxy',
			description:
				'Comma-separated hosts that should bypass configured proxy variables.',
			key: 'NO_PROXY',
			required: false,
			reserved: false,
			scope: 'app',
			title: 'Proxy bypass list',
			valueKind: 'plain',
		},
		...[
			'OPENAI_API_KEY',
			'ANTHROPIC_API_KEY',
			'GOOGLE_API_KEY',
			'GEMINI_API_KEY',
			'GROQ_API_KEY',
			'MISTRAL_API_KEY',
			'OPENROUTER_API_KEY',
			'VERCEL_AI_GATEWAY_API_KEY',
		].map((key) =>
			createCatalogEntry({
				category: 'provider',
				description:
					'Optional Ensemble-owned provider credential. Pi-owned provider credentials should stay in the Pi user environment unless explicitly overridden here.',
				key,
				title: formatEnvironmentVariableTitle(key),
				valueKind: 'secret',
			}),
		),
		createCatalogEntry({
			category: 'generic',
			description:
				'Generic debug selector for tools and scripts that honor DEBUG.',
			key: 'DEBUG',
			title: 'Debug selector',
			valueKind: 'plain',
		}),
		createCatalogEntry({
			category: 'generic',
			description:
				'Generic CI flag for tools and scripts that alter behavior in continuous-integration mode.',
			key: 'CI',
			title: 'CI mode',
			valueKind: 'plain',
		}),
		...[
			'ENSEMBLE_WORKSPACE_NAME',
			'ENSEMBLE_WORKSPACE_PATH',
			'ENSEMBLE_ROOT_PATH',
			'ENSEMBLE_DEFAULT_BRANCH',
			'ENSEMBLE_PORT',
			'CONDUCTOR_WORKSPACE_NAME',
			'CONDUCTOR_WORKSPACE_PATH',
			'CONDUCTOR_ROOT_PATH',
			'CONDUCTOR_DEFAULT_BRANCH',
			'CONDUCTOR_PORT',
		].map((key) =>
			createCatalogEntry({
				category: 'runtime',
				description:
					'Reserved workspace runtime variable populated by later workspace environment injection.',
				key,
				reserved: true,
				scope: 'workspace',
				title: formatEnvironmentVariableTitle(key),
				valueKind: 'runtime',
			}),
		),
	];

export class EnvironmentVariablesError extends Error {
	readonly code: EnvironmentVariablesErrorCode;

	constructor(code: EnvironmentVariablesErrorCode, message: string) {
		super(message);
		this.name = 'EnvironmentVariablesError';
		this.code = code;
	}
}

export function createEnvironmentVariablesService({
	configService,
	database = undefined,
	databaseService,
	now = () => new Date(),
	secretStore,
	secretStoreFactory = createDefaultSecretStore,
}: CreateEnvironmentVariablesServiceOptions): EnvironmentVariablesService {
	function getDatabase(): DatabaseSync | null {
		if (database !== undefined) {
			return database;
		}

		return databaseService?.getConnection()?.database ?? null;
	}

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

export function isEnvironmentVariableKey(value: string): boolean {
	return ENVIRONMENT_VARIABLE_KEY_PATTERN.test(value);
}

function createCatalogEntry({
	category,
	description,
	key,
	required = false,
	reserved = false,
	scope = 'app',
	title,
	valueKind,
}: {
	category: EnvironmentVariableCategory;
	description: string;
	key: string;
	required?: boolean;
	reserved?: boolean;
	scope?: EnvironmentVariableScope;
	title: string;
	valueKind: EnvironmentVariableValueKind;
}): EnvironmentVariableCatalogEntrySnapshot {
	return {
		category,
		description,
		key,
		required,
		reserved,
		scope,
		title,
		valueKind,
	};
}

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

function createVariableSnapshots(
	state: EnvironmentState,
): EnvironmentVariableSnapshot[] {
	const keys = new Set([
		...state.catalogByKey.keys(),
		...state.plainValues.keys(),
		...state.secretMetadata.keys(),
		...state.invalidKeys,
		...state.requiredKeys,
	]);

	const variables = Array.from(keys)
		.sort()
		.map((key) => createVariableSnapshot(key, state));

	for (const variable of variables) {
		if (variable.required && variable.status === 'unset') {
			state.diagnostics.push({
				code: 'required-variable-missing',
				key: variable.key,
				message: `${variable.key} is required but unset.`,
				severity: 'error',
			});
		}
	}

	return variables;
}

function createVariableSnapshot(
	key: string,
	state: EnvironmentState,
): EnvironmentVariableSnapshot {
	const baseCatalog = getCatalogEntryForKey(key, state.catalogByKey);
	const required = state.requiredKeys.has(key) || baseCatalog.required;
	const secretMetadata = state.secretMetadata.get(key);
	const plainValue = state.plainValues.get(key);
	const valueKind = getEffectiveValueKind({
		catalog: baseCatalog,
		key,
		secretMetadata,
	});
	const catalog = {
		...baseCatalog,
		required,
		valueKind,
	};

	if (!isEnvironmentVariableKey(key) || state.invalidKeys.has(key)) {
		return {
			catalog,
			key,
			required,
			scope: state.scope.scope,
			scopeId: state.scope.scopeId,
			source: null,
			status: 'invalid',
			valueKind,
		};
	}

	if (catalog.reserved) {
		if (plainValue || secretMetadata) {
			state.diagnostics.push({
				code: 'reserved-variable-ignored',
				key,
				message: `${key} is reserved for runtime environment injection and user-provided values are ignored.`,
				severity: 'warning',
			});
		}

		return {
			catalog,
			key,
			required,
			scope: state.scope.scope,
			scopeId: state.scope.scopeId,
			source: 'runtime',
			status: 'reserved',
			valueKind: 'runtime',
		};
	}

	if (secretMetadata) {
		return {
			catalog,
			characterCount: secretMetadata.characterCount,
			key,
			maskedDisplay: secretMetadata.maskedDisplay,
			required,
			scope: secretMetadata.scope,
			scopeId: secretMetadata.scopeId,
			source: 'secret-metadata',
			status: 'masked',
			valueKind: 'secret',
		};
	}

	if (plainValue) {
		return {
			catalog,
			displayValue:
				valueKind === 'secret' ? REDACTED_DISPLAY_VALUE : plainValue.value,
			key,
			required,
			scope: state.scope.scope,
			scopeId: state.scope.scopeId,
			source: plainValue.source,
			status: valueKind === 'secret' ? 'masked' : 'set',
			valueKind,
		};
	}

	return {
		catalog,
		key,
		required,
		scope: state.scope.scope,
		scopeId: state.scope.scopeId,
		source: null,
		status: 'unset',
		valueKind,
	};
}

function getEffectiveValueKind({
	catalog,
	key,
	secretMetadata,
}: {
	catalog: EnvironmentVariableCatalogEntrySnapshot;
	key: string;
	secretMetadata?: SecretMetadata;
}): EnvironmentVariableValueKind {
	if (catalog.valueKind === 'runtime') {
		return 'runtime';
	}

	if (
		secretMetadata ||
		isSecretEnvironmentVariableKey(key, new Map([[key, catalog]]))
	) {
		return 'secret';
	}

	return catalog.valueKind;
}

function collectConfigDefaults({
	catalogByKey,
	configEnvironment,
	diagnostics,
	invalidKeys,
}: {
	catalogByKey: Map<string, EnvironmentVariableCatalogEntrySnapshot>;
	configEnvironment: Record<string, unknown>;
	diagnostics: EnvironmentVariableDiagnostic[];
	invalidKeys: Set<string>;
}): Map<string, PlainValueCandidate> {
	const values = new Map<string, PlainValueCandidate>();

	for (const [key, value] of Object.entries(configEnvironment)) {
		if (!isEnvironmentVariableKey(key)) {
			invalidKeys.add(key);
			diagnostics.push({
				code: 'invalid-config-variable-key',
				key,
				message: `Config environment key "${key}" is not a valid environment variable name.`,
				severity: 'error',
			});
			continue;
		}

		if (!catalogByKey.has(key)) {
			catalogByKey.set(key, createCustomCatalogEntry(key));
		}

		if (typeof value !== 'string') {
			invalidKeys.add(key);
			diagnostics.push({
				code: 'invalid-config-variable-value',
				key,
				message: `Config environment value for ${key} must be a string.`,
				severity: 'error',
			});
			continue;
		}

		if (isSecretEnvironmentVariableKey(key, catalogByKey)) {
			invalidKeys.add(key);
			diagnostics.push({
				code: 'secret-config-variable-ignored',
				key,
				message: `${key} is secret-classified and must not be loaded from declarative config.`,
				severity: 'error',
			});
			continue;
		}

		values.set(key, {
			source: 'config-default',
			value,
		});
	}

	return values;
}

function collectSqlitePlainValues({
	database,
	diagnostics,
	invalidKeys,
	scope,
}: {
	database: DatabaseSync;
	diagnostics: EnvironmentVariableDiagnostic[];
	invalidKeys: Set<string>;
	scope: NormalizedScope;
}): Map<string, PlainValueCandidate> {
	const values = new Map<string, PlainValueCandidate>();
	const rows = database
		.prepare(
			`SELECT key, value_json
			 FROM settings
			 WHERE scope = ? AND scope_id = ? AND key LIKE ?
			 ORDER BY key`,
		)
		.all(scope.scope, scope.scopeId, `${ENVIRONMENT_SETTING_PREFIX}%`);

	for (const row of rows) {
		if (!isSqliteEnvironmentRow(row)) {
			continue;
		}

		const key = row.key.slice(ENVIRONMENT_SETTING_PREFIX.length);

		if (!isEnvironmentVariableKey(key)) {
			invalidKeys.add(key);
			diagnostics.push({
				code: 'invalid-sqlite-variable-key',
				key,
				message: `Stored environment variable key "${key}" is invalid.`,
				severity: 'error',
			});
			continue;
		}

		let parsed: unknown;

		try {
			parsed = JSON.parse(row.value_json);
		} catch {
			invalidKeys.add(key);
			diagnostics.push({
				code: 'invalid-sqlite-variable-json',
				key,
				message: `Stored environment variable value for ${key} is not valid JSON.`,
				severity: 'error',
			});
			continue;
		}

		if (typeof parsed !== 'string') {
			invalidKeys.add(key);
			diagnostics.push({
				code: 'invalid-sqlite-variable-value',
				key,
				message: `Stored environment variable value for ${key} must be a string.`,
				severity: 'error',
			});
			continue;
		}

		values.set(key, {
			source: 'sqlite',
			value: parsed,
		});
	}

	return values;
}

async function collectSecretMetadata({
	diagnostics,
	scope,
	secretStore,
}: {
	diagnostics: EnvironmentVariableDiagnostic[];
	scope: NormalizedScope;
	secretStore: SecretStore | null;
}): Promise<Map<string, SecretMetadata>> {
	const metadataByVariableKey = new Map<string, SecretMetadata>();

	if (!secretStore) {
		return metadataByVariableKey;
	}

	let metadata: SecretMetadata[];

	try {
		metadata = await secretStore.listMetadata({
			scope: scope.scope,
			scopeId: scope.scopeId,
		});
	} catch (error) {
		diagnostics.push({
			code: 'secret-metadata-unavailable',
			message:
				error instanceof Error
					? error.message
					: 'Secret metadata could not be loaded.',
			severity: 'warning',
		});
		return metadataByVariableKey;
	}

	for (const entry of metadata) {
		const variableKey = getEnvironmentVariableKeyFromSecretMetadata(entry);

		if (!variableKey) {
			continue;
		}

		if (!isEnvironmentVariableKey(variableKey)) {
			diagnostics.push({
				code: 'invalid-secret-variable-key',
				key: variableKey,
				message: `Secret metadata references invalid environment variable key "${variableKey}".`,
				severity: 'error',
			});
			continue;
		}

		metadataByVariableKey.set(variableKey, entry);
	}

	return metadataByVariableKey;
}

function createCatalogMap(): Map<
	string,
	EnvironmentVariableCatalogEntrySnapshot
> {
	return new Map(
		BUILT_IN_ENVIRONMENT_VARIABLE_CATALOG.map((entry) => [
			entry.key,
			{ ...entry },
		]),
	);
}

function getCatalogEntryForKey(
	key: string,
	catalogByKey: Map<string, EnvironmentVariableCatalogEntrySnapshot>,
): EnvironmentVariableCatalogEntrySnapshot {
	return catalogByKey.get(key) ?? createCustomCatalogEntry(key);
}

function createCustomCatalogEntry(
	key: string,
): EnvironmentVariableCatalogEntrySnapshot {
	return createCatalogEntry({
		category: 'custom',
		description:
			'User-defined environment variable prepared for future settings and process environment flows.',
		key,
		title: formatEnvironmentVariableTitle(key),
		valueKind: isSensitiveEnvironmentVariableName(key) ? 'secret' : 'plain',
	});
}

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

function requireDatabase(database: DatabaseSync | null): DatabaseSync {
	if (!database) {
		throw new EnvironmentVariablesError(
			'database-unavailable',
			'SQLite is unavailable; the environment variable was not saved.',
		);
	}

	return database;
}

function requireSecretStore(secretStore: SecretStore | null): SecretStore {
	if (!secretStore) {
		throw new EnvironmentVariablesError(
			'secret-store-unavailable',
			'The secret store is unavailable; the environment variable was not saved.',
		);
	}

	return secretStore;
}

function isReservedEnvironmentVariableKey(
	key: string,
	catalogByKey: Map<string, EnvironmentVariableCatalogEntrySnapshot>,
): boolean {
	return catalogByKey.get(key)?.reserved ?? false;
}

function isSecretEnvironmentVariableKey(
	key: string,
	catalogByKey: Map<string, EnvironmentVariableCatalogEntrySnapshot>,
): boolean {
	const catalogEntry = catalogByKey.get(key);

	return (
		catalogEntry?.valueKind === 'secret' ||
		isSensitiveEnvironmentVariableName(key)
	);
}

function isSensitiveEnvironmentVariableName(key: string): boolean {
	const normalized = key.replace(/[-_]/g, '').toLowerCase();

	return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

function toSettingKey(key: string): string {
	return `${ENVIRONMENT_SETTING_PREFIX}${key}`;
}

function toSecretStoreKey(key: string): string {
	return `${SECRET_ENVIRONMENT_KEY_PREFIX}${key}`;
}

function getEnvironmentVariableKeyFromSecretMetadata(
	metadata: SecretMetadata,
): string | null {
	const variableKey = metadata.metadata.variableKey;

	if (
		metadata.metadata.kind === 'environment-variable' &&
		typeof variableKey === 'string'
	) {
		return variableKey;
	}

	if (metadata.key.startsWith(SECRET_ENVIRONMENT_KEY_PREFIX)) {
		return metadata.key.slice(SECRET_ENVIRONMENT_KEY_PREFIX.length);
	}

	return null;
}

function createDefaultSecretStore(_database: DatabaseSync): SecretStore | null {
	return null;
}

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

function compareCatalogEntries(
	left: EnvironmentVariableCatalogEntrySnapshot,
	right: EnvironmentVariableCatalogEntrySnapshot,
): number {
	return `${left.category}:${left.key}`.localeCompare(
		`${right.category}:${right.key}`,
	);
}

function isSqliteEnvironmentRow(row: unknown): row is SqliteEnvironmentRow {
	return (
		typeof row === 'object' &&
		row !== null &&
		'key' in row &&
		'value_json' in row &&
		typeof row.key === 'string' &&
		typeof row.value_json === 'string'
	);
}

function formatEnvironmentVariableTitle(key: string): string {
	return key
		.split('_')
		.filter(Boolean)
		.map((part) =>
			part.length <= 3
				? part.toUpperCase()
				: `${part[0]?.toUpperCase() ?? ''}${part.slice(1).toLowerCase()}`,
		)
		.join(' ');
}
