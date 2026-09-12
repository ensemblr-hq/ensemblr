import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/**
 * App-scope settings key recording that the user has been shown, and accepted,
 * that this machine's keyring only obfuscates stored secrets.
 */
export const OBFUSCATED_STORAGE_ACKNOWLEDGEMENT_KEY =
	'secrets.obfuscatedStorageAcknowledgedAt';

/** The record persisted at {@link OBFUSCATED_STORAGE_ACKNOWLEDGEMENT_KEY}. */
interface ObfuscatedStorageAcknowledgementRecord {
	/** Keyring backend id the user accepted, e.g. `basic_text`. */
	backend: string;
	/** When the user accepted it. */
	at: string;
}

/**
 * Reads the raw acknowledgement record, or null when none is on record or the
 * stored value cannot be parsed.
 * @param database - Open connection, or null when the database is unavailable.
 * @returns The record, or null.
 */
function readRecord(
	database: DatabaseSync | null,
): ObfuscatedStorageAcknowledgementRecord | null {
	if (!database) {
		return null;
	}

	const row = database
		.prepare(
			`SELECT value_json FROM settings
			 WHERE scope = 'app' AND scope_id = '' AND key = ?`,
		)
		.get(OBFUSCATED_STORAGE_ACKNOWLEDGEMENT_KEY) as
		| { value_json: string }
		| undefined;

	if (typeof row?.value_json !== 'string') {
		return null;
	}

	try {
		const parsed: unknown = JSON.parse(row.value_json);
		return typeof parsed === 'object' &&
			parsed !== null &&
			typeof (parsed as { backend?: unknown }).backend === 'string' &&
			typeof (parsed as { at?: unknown }).at === 'string'
			? (parsed as ObfuscatedStorageAcknowledgementRecord)
			: null;
	} catch {
		return null;
	}
}

/**
 * Reads whether the user has accepted storing secrets under `keyringBackend`.
 *
 * Keyed on the backend id rather than just a timestamp, so if the session
 * later selects a different obfuscating backend the warning is raised again
 * rather than staying silenced by an acknowledgement of a different one.
 *
 * Kept in the `settings` table rather than behind an injected service so the
 * secret store can consult it with the database handle it already holds — the
 * same shape `src/main/environment/settings-table.ts` and
 * `src/main/app/window-state.ts` use for their own rows.
 * @param database - Open connection, or null when the database is unavailable.
 * @param keyringBackend - Backend id the session currently selects.
 * @returns True when an acknowledgement of this exact backend is on record.
 */
export function readObfuscatedStorageAcknowledgement(
	database: DatabaseSync | null,
	keyringBackend: string,
): boolean {
	return readRecord(database)?.backend === keyringBackend;
}

/**
 * Records that the user accepted `keyringBackend`, stamping when they did so a
 * later change of backend can be told apart from this one.
 * @param database - Open connection.
 * @param keyringBackend - Backend id the user accepted.
 * @param now - Clock injection point.
 */
export function writeObfuscatedStorageAcknowledgement(
	database: DatabaseSync,
	keyringBackend: string,
	now: () => Date = () => new Date(),
): void {
	const timestamp = now().toISOString();
	const record: ObfuscatedStorageAcknowledgementRecord = {
		at: timestamp,
		backend: keyringBackend,
	};

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
			JSON.stringify(record),
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
