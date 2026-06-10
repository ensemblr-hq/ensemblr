import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { toSettingKey } from './environment-variable-keys.ts';
import type { NormalizedScope } from './environment-variable-types.ts';

/**
 * Inserts or updates a plain env var row in the SQLite `settings` table.
 * The persisted `source` is always `'sqlite'` and `locked` is reset to 0 —
 * scope and key together form the upsert conflict target.
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
			toSettingKey(key),
			JSON.stringify(value),
			timestamp,
		);
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
	database
		.prepare(
			`DELETE FROM settings
			 WHERE scope = ? AND scope_id = ? AND key = ?`,
		)
		.run(scope.scope, scope.scopeId, toSettingKey(key));
}
