import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/**
 * App-scope settings key recording that the user has been shown, and accepted,
 * that this machine's keyring only obfuscates stored secrets.
 */
export const OBFUSCATED_STORAGE_ACKNOWLEDGEMENT_KEY =
	'secrets.obfuscatedStorageAcknowledgedAt';

/**
 * Reads whether the user has accepted storing secrets under an obfuscating
 * keyring backend.
 *
 * Kept in the `settings` table rather than behind an injected service so the
 * secret store can consult it with the database handle it already holds — the
 * same shape `src/main/environment/settings-table.ts` and
 * `src/main/app/window-state.ts` use for their own rows.
 * @param database - Open connection, or null when the database is unavailable.
 * @returns True when an acknowledgement is on record.
 */
export function readObfuscatedStorageAcknowledgement(
	database: DatabaseSync | null,
): boolean {
	if (!database) {
		return false;
	}

	const row = database
		.prepare(
			`SELECT value_json FROM settings
			 WHERE scope = 'app' AND scope_id = '' AND key = ?`,
		)
		.get(OBFUSCATED_STORAGE_ACKNOWLEDGEMENT_KEY) as
		| { value_json: string }
		| undefined;

	return typeof row?.value_json === 'string' && row.value_json !== 'null';
}

/**
 * Records that the user accepted an obfuscating keyring backend, stamping when
 * they did so the warning can be re-raised if the backend later changes.
 * @param database - Open connection.
 * @param now - Clock injection point.
 */
export function writeObfuscatedStorageAcknowledgement(
	database: DatabaseSync,
	now: () => Date = () => new Date(),
): void {
	const timestamp = now().toISOString();

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
			VALUES (?, 'app', '', ?, ?, 'sqlite', 0, ?)
			ON CONFLICT(scope, scope_id, key) DO UPDATE SET
				value_json = excluded.value_json,
				source = 'sqlite',
				locked = 0,
				updated_at = excluded.updated_at`,
		)
		.run(
			`setting-${randomUUID()}`,
			OBFUSCATED_STORAGE_ACKNOWLEDGEMENT_KEY,
			JSON.stringify(timestamp),
			timestamp,
		);
}

/**
 * Clears a recorded acknowledgement, so the warning is raised again.
 * @param database - Open connection.
 */
export function clearObfuscatedStorageAcknowledgement(
	database: DatabaseSync,
): void {
	database
		.prepare(
			`DELETE FROM settings
			 WHERE scope = 'app' AND scope_id = '' AND key = ?`,
		)
		.run(OBFUSCATED_STORAGE_ACKNOWLEDGEMENT_KEY);
}
