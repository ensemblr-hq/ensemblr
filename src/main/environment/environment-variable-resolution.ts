import type { DatabaseSync } from 'node:sqlite';

import type { EnvironmentVariableDiagnostic } from '../../shared/ipc/contracts/environment';
import type { EnsembleConfigService } from '../config/config-loader';
import type { SecretStore } from '../secrets/secret-store';
import {
	createCatalogMap,
	createCustomCatalogEntry,
} from './environment-variable-catalog.ts';
import {
	collectConfigDefaults,
	collectSecretMetadata,
	collectSqlitePlainValues,
} from './environment-variable-collectors.ts';
import { isEnvironmentVariableKey } from './environment-variable-keys.ts';
import type {
	EnvironmentState,
	NormalizedScope,
	PlainValueCandidate,
} from './environment-variable-types.ts';

/** Inputs for {@link resolveEnvironmentVariables}. */
export interface ResolveEnvironmentVariablesOptions {
	configService: EnsembleConfigService;
	database: DatabaseSync | null;
	now: () => Date;
	requiredKeys?: readonly string[];
	scope: NormalizedScope;
	secretStore: SecretStore | null;
}

/**
 * Collects every input the snapshot/assembly renderers need (config defaults,
 * SQLite rows, secret metadata, catalog) for the requested scope and merges
 * them into a single {@link EnvironmentState}, applying source precedence
 * (config-default < sqlite, secret metadata overlays plain values downstream).
 * @param input - Service dependencies and resolved scope.
 * @returns The merged environment state.
 */
export async function resolveEnvironmentVariables({
	configService,
	database,
	now: _now,
	requiredKeys: requestedRequiredKeys,
	scope,
	secretStore,
}: ResolveEnvironmentVariablesOptions): Promise<EnvironmentState> {
	const diagnostics: EnvironmentVariableDiagnostic[] = [];
	const invalidKeys = new Set<string>();
	const catalogByKey = createCatalogMap();
	const requiredKeys = normalizeRequiredKeys(
		requestedRequiredKeys,
		diagnostics,
	);

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
