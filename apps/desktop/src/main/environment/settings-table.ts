import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { NormalizedScope } from './environment-variable-types.ts';

/**
 * Inserts or updates a single row in the SQLite `settings` table. The persisted
 * `source` is always `'sqlite'` and `locked` is reset to 0 — `(scope, scope_id,
 * key)` together form the upsert conflict target.
 * @param input - Database handle, normalised scope, fully-qualified key, and the
 *   JSON-encoded value to persist.
 */
export function upsertSetting({
	database,
	key,
	scope,
	valueJson,
}: {
	database: DatabaseSync;
	key: string;
	scope: NormalizedScope;
	valueJson: string;
}): void {
	const timestamp = new Date().toISOString();

	database
		.prepare(
			`INSERT INTO settings (
				id,
				scope,
				scope_id,
				key,
				value_json,
				source,
				locked,
				updated_at
			)
			VALUES (?, ?, ?, ?, ?, 'sqlite', 0, ?)
			ON CONFLICT(scope, scope_id, key) DO UPDATE SET
				value_json = excluded.value_json,
				source = 'sqlite',
				locked = 0,
				updated_at = excluded.updated_at`,
		)
		.run(
			`setting-${randomUUID()}`,
			scope.scope,
			scope.scopeId,
			key,
			valueJson,
			timestamp,
		);
}

/**
 * Reads the raw `value_json` for a settings row, or `null` when absent.
 * @param input - Database handle, normalised scope, and fully-qualified key.
 * @returns The stored JSON text, or `null`.
 */
export function readSettingJson({
	database,
	key,
	scope,
}: {
	database: DatabaseSync;
	key: string;
	scope: NormalizedScope;
}): string | null {
	const row = database
		.prepare(
			`SELECT value_json FROM settings
			 WHERE scope = ? AND scope_id = ? AND key = ?`,
		)
		.get(scope.scope, scope.scopeId, key) as { value_json: string } | undefined;

	return row?.value_json ?? null;
}

/**
 * Removes a settings row, if present.
 * @param input - Database handle, normalised scope, and fully-qualified key.
 */
export function deleteSetting({
	database,
	key,
	scope,
}: {
	database: DatabaseSync;
	key: string;
	scope: NormalizedScope;
}): void {
	database
		.prepare(
			`DELETE FROM settings
			 WHERE scope = ? AND scope_id = ? AND key = ?`,
		)
		.run(scope.scope, scope.scopeId, key);
}
