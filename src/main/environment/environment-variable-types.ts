import type { EnvironmentVariableCatalogEntrySnapshot, EnvironmentVariableDiagnostic, EnvironmentVariableScope } from '../../shared/ipc/contracts/environment';
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

/** Internal: accumulated state used to render a snapshot or assembled env. */
export interface EnvironmentState {
	catalogByKey: Map<string, EnvironmentVariableCatalogEntrySnapshot>;
	diagnostics: EnvironmentVariableDiagnostic[];
	invalidKeys: Set<string>;
	plainValues: Map<string, PlainValueCandidate>;
	requiredKeys: Set<string>;
	scope: NormalizedScope;
	secretMetadata: Map<string, SecretMetadata>;
	secretStore: SecretStore | null;
}

/** Display token rendered in place of a plain value classified as secret. */
export const REDACTED_DISPLAY_VALUE = '[set]';
