import type { DatabaseSync } from 'node:sqlite';

import type { EnvironmentVariableDiagnostic } from '../../shared/ipc/contracts/environment';
import type { NormalizedScope } from './environment-variable-types.ts';
import { loadEnvFile } from './parse-env-file.ts';
import {
	deleteSetting,
	readSettingJson,
	upsertSetting,
} from './settings-table.ts';

/**
 * Settings-table key holding the ordered list of env-file paths for a scope.
 * Deliberately outside the `environment.variables.` namespace so env files and
 * individual variables never collide.
 */
export const ENVIRONMENT_FILES_SETTING_KEY = 'environment.files';

/** Merged env-file values for a scope plus diagnostics for unreadable files. */
export interface ScopeEnvFiles {
	/** Diagnostics for files that could not be read. */
	diagnostics: EnvironmentVariableDiagnostic[];
	/** Merged `KEY=value` pairs (later files override earlier ones). */
	values: Record<string, string>;
}

/**
 * Reads the ordered list of env-file paths persisted for a scope.
 * @param database - Active SQLite handle.
 * @param scope - Normalised scope to read.
 * @returns The stored paths, or an empty array when none/invalid.
 */
export function readEnvFilePaths(
	database: DatabaseSync,
	scope: NormalizedScope,
): string[] {
	const valueJson = readSettingJson({
		database,
		key: ENVIRONMENT_FILES_SETTING_KEY,
		scope,
	});

	if (valueJson === null) {
		return [];
	}

	try {
		const parsed: unknown = JSON.parse(valueJson);

		return Array.isArray(parsed)
			? parsed.filter((entry): entry is string => typeof entry === 'string')
			: [];
	} catch {
		return [];
	}
}

/**
 * Persists the ordered list of env-file paths for a scope, replacing any prior
 * value. Writing an empty list removes the row entirely.
 * @param database - Active SQLite handle.
 * @param scope - Normalised scope to write.
 * @param paths - Ordered paths to persist.
 */
export function writeEnvFilePaths({
	database,
	paths,
	scope,
}: {
	database: DatabaseSync;
	paths: readonly string[];
	scope: NormalizedScope;
}): void {
	if (paths.length === 0) {
		deleteSetting({ database, key: ENVIRONMENT_FILES_SETTING_KEY, scope });
		return;
	}

	upsertSetting({
		database,
		key: ENVIRONMENT_FILES_SETTING_KEY,
		scope,
		valueJson: JSON.stringify([...paths]),
	});
}

/**
 * Loads and merges every env file configured for a scope, in order, so the
 * snapshot and assembly paths agree on which keys env files provide. Later
 * files override earlier ones; unreadable files yield a warning diagnostic and
 * are skipped.
 * @param database - Active SQLite handle.
 * @param scope - Normalised scope to read.
 * @returns The merged values plus any unreadable-file diagnostics.
 */
export function loadScopeEnvFiles({
	database,
	scope,
}: {
	database: DatabaseSync;
	scope: NormalizedScope;
}): ScopeEnvFiles {
	const values: Record<string, string> = {};
	const diagnostics: EnvironmentVariableDiagnostic[] = [];

	for (const filePath of readEnvFilePaths(database, scope)) {
		const loaded = loadEnvFile(filePath);

		if (loaded.error) {
			diagnostics.push({
				code: 'env-file-unreadable',
				message: loaded.error,
				severity: 'warning',
			});
			continue;
		}

		for (const [key, value] of Object.entries(loaded.values)) {
			values[key] = value;
		}
	}

	return { diagnostics, values };
}
