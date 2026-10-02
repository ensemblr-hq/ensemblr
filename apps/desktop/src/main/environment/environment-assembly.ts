import type { DatabaseSync } from 'node:sqlite';

import type { EnvironmentVariableDiagnostic } from '../../shared/ipc/contracts/environment';
import { type SecretScope, SecretStoreError } from '../secrets/index.ts';
import { loadScopeEnvFiles } from './env-files-repository.ts';
import {
	isReservedEnvironmentVariableKey,
	isSecretEnvironmentVariableKey,
} from './environment-variable-keys.ts';
import type { EnvironmentState } from './environment-variable-types.ts';

/**
 * One precedence layer of the assembled environment, plus the diagnostics it
 * raised and the secret values command output must redact.
 */
export interface EnvironmentLayer {
	diagnostics: readonly EnvironmentVariableDiagnostic[];
	env: Record<string, string>;
	redactValues: readonly string[];
}

/** A layer that contributes nothing, used when a layer is switched off. */
export const EMPTY_ENVIRONMENT_LAYER: EnvironmentLayer = {
	diagnostics: [],
	env: {},
	redactValues: [],
};

/**
 * Read the lowest-precedence layer: the scope's env-file values. Reserved
 * runtime keys are never sourced from a file, while secret-shaped file values
 * are redacted from command output to match the secret store's guarantee.
 * @param database - Open SQLite connection, or null when storage is unavailable
 * @param state - Resolved environment state carrying the catalog and scope
 * @returns The env-file layer, empty when there is no database to read from
 */
export function readEnvFileLayer({
	database,
	state,
}: {
	database: DatabaseSync | null;
	state: EnvironmentState;
}): EnvironmentLayer {
	if (!database) {
		return EMPTY_ENVIRONMENT_LAYER;
	}

	const envFiles = loadScopeEnvFiles({ database, scope: state.scope });
	const env: Record<string, string> = {};
	const redactValues: string[] = [];

	for (const [key, value] of Object.entries(envFiles.values)) {
		if (isReservedEnvironmentVariableKey(key, state.catalogByKey)) {
			continue;
		}
		env[key] = value;
		if (isSecretEnvironmentVariableKey(key, state.catalogByKey)) {
			redactValues.push(value);
		}
	}

	return { diagnostics: envFiles.diagnostics, env, redactValues };
}

/**
 * Read the layer a linked Infisical project supplies. It sits above env files
 * and below explicit local values, so a variable set by hand in Ensemblr still
 * wins while a developer debugs against a local service. Every value is
 * redacted from command output, because everything Infisical stores is a
 * secret.
 * @param state - Resolved environment state carrying the Infisical values
 * @returns The Infisical layer
 */
export function readInfisicalLayer(state: EnvironmentState): EnvironmentLayer {
	const env: Record<string, string> = {};
	const redactValues: string[] = [];

	for (const [key, value] of state.infisicalValues) {
		if (isReservedEnvironmentVariableKey(key, state.catalogByKey)) {
			continue;
		}

		env[key] = value;

		if (value) {
			redactValues.push(value);
		}
	}

	return { diagnostics: [], env, redactValues };
}

/**
 * Read the explicit plain-value layer, skipping reserved keys and any key the
 * secret store owns.
 * @param state - Resolved environment state carrying the plain candidates
 * @returns The plain-value layer
 */
export function readPlainLayer(state: EnvironmentState): EnvironmentLayer {
	const env: Record<string, string> = {};

	for (const [key, candidate] of state.plainValues) {
		if (
			isReservedEnvironmentVariableKey(key, state.catalogByKey) ||
			state.secretMetadata.has(key)
		) {
			continue;
		}
		env[key] = candidate.value;
	}

	return { diagnostics: [], env, redactValues: [] };
}

/**
 * Read one secret, turning a keyring failure into a reportable outcome rather
 * than a rejection.
 *
 * A decrypt failure is recoverable per secret — the user re-enters that one —
 * but it used to reject the whole `Promise.all` below and take every terminal
 * and agent launch down with it. `undecryptable` stays distinct from a `null`
 * value so "the keyring changed" never reads as "nothing was ever stored".
 * @param secretStore - Store to read from
 * @param key - Environment variable key the secret backs
 * @param metadata - Metadata row identifying the secret
 * @returns The value, or the message explaining why it could not be read
 */
async function readOneSecret(
	secretStore: NonNullable<EnvironmentState['secretStore']>,
	key: string,
	metadata: { key: string; scope: SecretScope; scopeId: string },
): Promise<{ key: string; undecryptable?: string; value: string | null }> {
	try {
		const value = await secretStore.read({
			key: metadata.key,
			scope: metadata.scope,
			scopeId: metadata.scopeId || undefined,
		});
		return { key, value };
	} catch (error) {
		if (error instanceof SecretStoreError) {
			return { key, undecryptable: error.message, value: null };
		}
		throw error;
	}
}

/**
 * Resolve the highest-precedence layer by reading each secret out of the secret
 * store, reporting metadata whose value has gone missing or cannot be decrypted.
 * @param state - Resolved environment state carrying the secret metadata and store
 * @returns The secret layer, with every resolved value marked for redaction
 */
export async function readSecretLayer(
	state: EnvironmentState,
): Promise<EnvironmentLayer> {
	const { secretStore } = state;
	if (!secretStore) {
		return state.secretMetadata.size > 0
			? {
					diagnostics: [
						{
							code: 'secret-store-unavailable',
							message:
								'Secret metadata exists, but the secret store is unavailable.',
							severity: 'warning',
						},
					],
					env: {},
					redactValues: [],
				}
			: EMPTY_ENVIRONMENT_LAYER;
	}

	const resolved = await Promise.all(
		Array.from(state.secretMetadata).map(async ([key, metadata]) => {
			if (isReservedEnvironmentVariableKey(key, state.catalogByKey)) {
				return null;
			}
			return readOneSecret(secretStore, key, metadata);
		}),
	);

	const diagnostics: EnvironmentVariableDiagnostic[] = [];
	const env: Record<string, string> = {};
	const redactValues: string[] = [];

	for (const entry of resolved) {
		if (!entry) {
			continue;
		}
		if (entry.undecryptable) {
			diagnostics.push({
				code: 'secret-value-undecryptable',
				key: entry.key,
				message: entry.undecryptable,
				severity: 'error',
			});
			continue;
		}
		if (entry.value === null) {
			diagnostics.push({
				code: 'secret-value-missing',
				key: entry.key,
				message: 'Secret metadata exists, but the secret value was not found.',
				severity: 'warning',
			});
			continue;
		}
		env[entry.key] = entry.value;
		redactValues.push(entry.value);
	}

	return { diagnostics, env, redactValues };
}

/**
 * Report every required key the assembled environment left unset.
 * @param env - The fully merged environment
 * @param requiredKeys - Keys the caller declared required
 * @returns One error diagnostic per missing key
 */
export function missingRequiredDiagnostics({
	env,
	requiredKeys,
}: {
	env: Record<string, string>;
	requiredKeys: ReadonlySet<string>;
}): EnvironmentVariableDiagnostic[] {
	const diagnostics: EnvironmentVariableDiagnostic[] = [];
	for (const requiredKey of requiredKeys) {
		if (!env[requiredKey]) {
			diagnostics.push({
				code: 'required-variable-missing',
				key: requiredKey,
				message: `${requiredKey} is required but unset.`,
				severity: 'error',
			});
		}
	}
	return diagnostics;
}
