import type {
	EnvironmentVariableCatalogEntrySnapshot,
	EnvironmentVariableDiagnostic,
	EnvironmentVariableScope,
} from '../../shared/ipc/contracts/environment';
import type { SettingsResolutionSource } from '../../shared/ipc/contracts/settings-resolution';
import type { SecretMetadata, SecretStore } from '../secrets/secret-store';

/** Internal: a normalised `(scope, scopeId)` pair. */
export interface NormalizedScope {
	scope: EnvironmentVariableScope;
	scopeId: string;
}

/** Internal: one plain-string candidate value with its source. */
export interface PlainValueCandidate {
	source: Extract<SettingsResolutionSource, 'config-default' | 'sqlite'>;
	value: string;
}

/** Internal: shape of an environment-variable row in the settings table. */
export interface SqliteEnvironmentRow {
	key: string;
	value_json: string;
}

/**
 * Values a linked Infisical project supplies for one scope, plus a
 * locale-neutral reason when the answer is degraded — served from a stale
 * cache, unreachable, or waiting on the user to pick a local account.
 */
export interface InfisicalScopeResolution {
	degradedReason: 'no-account' | 'stale-cache' | 'unavailable' | null;
	values: Record<string, string>;
}

/**
 * Resolves a scope's Infisical values. Injected rather than imported so this
 * module never depends on `src/main/infisical/`, and so tests can supply a fake
 * without a network or a Keychain. It must never throw: an empty result is
 * always a valid answer.
 */
export type InfisicalEnvironmentResolver = (
	scope: NormalizedScope,
) => Promise<InfisicalScopeResolution>;

/** Internal: accumulated state used to render a snapshot or assembled env. */
export interface EnvironmentState {
	catalogByKey: Map<string, EnvironmentVariableCatalogEntrySnapshot>;
	diagnostics: EnvironmentVariableDiagnostic[];
	/** Values a linked Infisical project supplies, keyed by variable name. */
	infisicalValues: Map<string, string>;
	invalidKeys: Set<string>;
	plainValues: Map<string, PlainValueCandidate>;
	requiredKeys: Set<string>;
	scope: NormalizedScope;
	secretMetadata: Map<string, SecretMetadata>;
	secretStore: SecretStore | null;
}

/** Display token rendered in place of a plain value classified as secret. */
export const REDACTED_DISPLAY_VALUE = '[set]';
