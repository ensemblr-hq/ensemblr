import type { DatabaseSync } from 'node:sqlite';

import { toSettingKey } from './environment-variable-keys.ts';
import type { NormalizedScope } from './environment-variable-types.ts';
import {
	deleteSetting,
	readSettingJson,
	upsertSetting,
} from './settings-table.ts';

/**
 * Inserts or updates a plain env var row in the SQLite `settings` table.
 * Scope and key together form the upsert conflict target.
 */
export function upsertPlainSetting({
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
	upsertSetting({
		database,
		key: toSettingKey(key),
		scope,
		valueJson: JSON.stringify(value),
	});
}

/**
 * Reads the persisted plain value for an env var, or `null` when absent/invalid.
 * @returns The decoded string value, or `null`.
 */
export function readPlainSetting({
	database,
	key,
	scope,
}: {
	database: DatabaseSync;
	key: string;
	scope: NormalizedScope;
}): string | null {
	const valueJson = readSettingJson({
		database,
		key: toSettingKey(key),
		scope,
	});

	if (valueJson === null) {
		return null;
	}

	try {
		const parsed: unknown = JSON.parse(valueJson);

		return typeof parsed === 'string' ? parsed : null;
	} catch {
		return null;
	}
}

/** Removes the plain env var row from the SQLite `settings` table, if any. */
export function deletePlainSetting({
	database,
	key,
	scope,
}: {
	database: DatabaseSync;
	key: string;
	scope: NormalizedScope;
}): void {
	deleteSetting({ database, key: toSettingKey(key), scope });
}
