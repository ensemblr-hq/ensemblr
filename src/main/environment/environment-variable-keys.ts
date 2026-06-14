import type { EnvironmentVariableCatalogEntrySnapshot } from '../../shared/ipc/contracts/environment';
import type { SecretMetadata } from '../secrets/secret-store';
import { isSensitiveEnvironmentVariableName } from './environment-variable-catalog.ts';

/** Prefix on every env-var row in the SQLite `settings` table. */
export const ENVIRONMENT_SETTING_PREFIX = 'environment.variables.';

/** Prefix on every env-var key in the secret store. */
export const SECRET_ENVIRONMENT_KEY_PREFIX = 'environment:variables:';

/** Matches a valid POSIX environment variable name. */
const ENVIRONMENT_VARIABLE_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Tests whether a string is a valid POSIX env var name.
 * @param value - Candidate name.
 * @returns True when the name matches the env-var character rules.
 */
export function isEnvironmentVariableKey(value: string): boolean {
	return ENVIRONMENT_VARIABLE_KEY_PATTERN.test(value);
}

/**
 * Tests whether a key is flagged `reserved` in the catalog.
 * @param key - Variable name.
 * @param catalogByKey - Active catalog map.
 * @returns True when reserved.
 */
export function isReservedEnvironmentVariableKey(
	key: string,
	catalogByKey: Map<string, EnvironmentVariableCatalogEntrySnapshot>,
): boolean {
	return catalogByKey.get(key)?.reserved ?? false;
}

/**
 * Tests whether a key is catalog-classified or name-shaped as a secret.
 * @param key - Variable name.
 * @param catalogByKey - Active catalog map.
 * @returns True when secret-classified.
 */
export function isSecretEnvironmentVariableKey(
	key: string,
	catalogByKey: Map<string, EnvironmentVariableCatalogEntrySnapshot>,
): boolean {
	const catalogEntry = catalogByKey.get(key);

	return (
		catalogEntry?.valueKind === 'secret' ||
		isSensitiveEnvironmentVariableName(key)
	);
}

/**
 * Maps a variable name to its `settings` table key.
 * @param key - Variable name.
 * @returns The qualified setting key.
 */
export function toSettingKey(key: string): string {
	return `${ENVIRONMENT_SETTING_PREFIX}${key}`;
}

/**
 * Maps a variable name to its secret-store key.
 * @param key - Variable name.
 * @returns The qualified secret-store key.
 */
export function toSecretStoreKey(key: string): string {
	return `${SECRET_ENVIRONMENT_KEY_PREFIX}${key}`;
}

/**
 * Extracts the env var name from a secret store metadata entry.
 * @param metadata - Secret store metadata.
 * @returns The variable name, or `null` when the entry is unrelated.
 */
export function getEnvironmentVariableKeyFromSecretMetadata(
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
