import type { DatabaseSync } from 'node:sqlite';

import type {
	EnvironmentVariableCatalogEntrySnapshot,
	EnvironmentVariableDiagnostic,
} from '../../shared/ipc/contracts/environment';
import type { SecretMetadata, SecretStore } from '../secrets/secret-store';
import { createCustomCatalogEntry } from './environment-variable-catalog.ts';
import {
	ENVIRONMENT_SETTING_PREFIX,
	getEnvironmentVariableKeyFromSecretMetadata,
	isEnvironmentVariableKey,
	isSecretEnvironmentVariableKey,
} from './environment-variable-keys.ts';
import type {
	InfisicalEnvironmentResolver,
	NormalizedScope,
	PlainValueCandidate,
	SqliteEnvironmentRow,
} from './environment-variable-types.ts';

/** Diagnostic messages for each way an Infisical resolution can be degraded. */
const INFISICAL_DEGRADED_DIAGNOSTICS = {
	'no-account': {
		code: 'infisical-account-unresolved',
		message:
			'This scope is linked to an Infisical project, but no local account matches its instance.',
	},
	'stale-cache': {
		code: 'infisical-cache-stale',
		message:
			'Infisical could not be reached; cached values from the last successful sync were used.',
	},
	unavailable: {
		code: 'infisical-unavailable',
		message:
			'Infisical could not be reached and no cached values are available for this scope.',
	},
} as const;

/**
 * Pulls plain env-var defaults from the declarative `environment` config block,
 * registering custom catalog entries and rejecting secret-classified keys.
 * @param input - Catalog, raw config block, and diagnostic sinks.
 * @returns Map of `key -> plain candidate`.
 */
export function collectConfigDefaults({
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

/**
 * Reads plain env-var values persisted in the SQLite `settings` table for the
 * given scope, emitting diagnostics for malformed rows.
 * @param input - Database, scope, and diagnostic sinks.
 * @returns Map of `key -> plain candidate`.
 */
export function collectSqlitePlainValues({
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

/**
 * Resolves the values a linked Infisical project supplies for the scope. A
 * resolver failure, a stale cache, or an unresolved account all degrade to a
 * warning rather than an error: Infisical being unreachable must never stop a
 * workspace from opening.
 * @param input - Scope, resolver, and diagnostic sink.
 * @returns Map of `key -> value`, empty when nothing is linked.
 */
export async function collectInfisicalValues({
	diagnostics,
	invalidKeys,
	resolveInfisical,
	scope,
}: {
	diagnostics: EnvironmentVariableDiagnostic[];
	invalidKeys: Set<string>;
	resolveInfisical: InfisicalEnvironmentResolver | null;
	scope: NormalizedScope;
}): Promise<Map<string, string>> {
	const values = new Map<string, string>();

	if (!resolveInfisical || scope.scope === 'app') {
		return values;
	}

	let resolution: Awaited<ReturnType<InfisicalEnvironmentResolver>>;

	try {
		resolution = await resolveInfisical(scope);
	} catch (error) {
		diagnostics.push({
			code: 'infisical-unavailable',
			message:
				error instanceof Error
					? error.message
					: 'Infisical values could not be resolved.',
			severity: 'warning',
		});

		return values;
	}

	if (resolution.degradedReason) {
		diagnostics.push({
			...INFISICAL_DEGRADED_DIAGNOSTICS[resolution.degradedReason],
			severity: 'warning',
		});
	}

	for (const [key, value] of Object.entries(resolution.values)) {
		if (!isEnvironmentVariableKey(key)) {
			invalidKeys.add(key);
			diagnostics.push({
				code: 'invalid-infisical-variable-key',
				key,
				message: `Infisical secret "${key}" is not a valid environment variable name and was skipped.`,
				severity: 'warning',
			});
			continue;
		}

		values.set(key, value);
	}

	return values;
}

/**
 * Lists secret metadata for the scope and maps each entry to its env var key,
 * surfacing store failures as warnings rather than throwing.
 * @param input - Scope, store, and diagnostic sink.
 * @returns Map of `variable key -> metadata`.
 */
export async function collectSecretMetadata({
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

/**
 * Type guard for the row shape returned by the env-var SQLite query.
 * @param row - Candidate row value.
 * @returns True when the row exposes string `key` and `value_json` columns.
 */
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
