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
	NormalizedScope,
	PlainValueCandidate,
	SqliteEnvironmentRow,
} from './environment-variable-types.ts';

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
