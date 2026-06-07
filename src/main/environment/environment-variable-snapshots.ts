import type {
	EnvironmentVariableCatalogEntrySnapshot,
	EnvironmentVariableSnapshot,
	EnvironmentVariableValueKind,
} from '../../shared/ipc';
import type { SecretMetadata } from '../secrets/secret-store';
import { getCatalogEntryForKey } from './environment-variable-catalog.ts';
import {
	isEnvironmentVariableKey,
	isSecretEnvironmentVariableKey,
} from './environment-variable-keys.ts';
import {
	type EnvironmentState,
	REDACTED_DISPLAY_VALUE,
} from './environment-variable-types.ts';

/**
 * Renders one snapshot per known key (catalog, plain, secret, required, invalid)
 * sorted alphabetically, and emits a missing-required diagnostic for each unset
 * required key.
 * @param state - Collected environment state.
 * @returns An array of per-variable snapshots.
 */
export function createVariableSnapshots(
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

/**
 * Renders a single variable snapshot from collected state, honoring reserved
 * keys, invalid keys, and the secret-vs-plain precedence rules.
 * @param key - Variable name.
 * @param state - Collected environment state.
 * @returns The variable snapshot.
 */
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

/**
 * Determines whether a variable should be treated as runtime/secret/plain at
 * snapshot time, escalating to `secret` whenever metadata or name signals it.
 * @param input - Catalog entry, key, and any secret metadata.
 * @returns The effective value kind.
 */
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
