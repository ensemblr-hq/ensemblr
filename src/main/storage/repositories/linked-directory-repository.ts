import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/**
 * One stored recents entry. Deliberately narrower than the wire shape: whether
 * the directory still exists is resolved at read time, never persisted, so a
 * folder on a volume that is merely unmounted is not written off as gone.
 */
export interface LinkedDirectoryRecentRow {
	lastUsedAt: string;
	name: string;
	path: string;
}

/**
 * Settings key holding the app-global recents list. Scoped to `app` with an
 * empty `scope_id` so the list is the same whichever repository or workspace the
 * user happens to have open.
 */
const RECENTS_KEY = 'linked-directories.recents';
const RECENTS_SCOPE = 'app';
const RECENTS_SCOPE_ID = '';

/**
 * Parses one persisted entry, rejecting anything that does not carry the three
 * strings the list is built from. The blob is JSON on disk, so a partially
 * written or hand-edited row has to be discarded rather than trusted.
 * @param value - One decoded element of the stored array.
 * @returns The entry, or null when the shape does not hold.
 */
function parseRow(value: unknown): LinkedDirectoryRecentRow | null {
	if (typeof value !== 'object' || value === null) {
		return null;
	}
	const candidate = value as Partial<LinkedDirectoryRecentRow>;
	if (
		typeof candidate.path !== 'string' ||
		typeof candidate.name !== 'string' ||
		typeof candidate.lastUsedAt !== 'string' ||
		candidate.path.length === 0
	) {
		return null;
	}
	return {
		lastUsedAt: candidate.lastUsedAt,
		name: candidate.name,
		path: candidate.path,
	};
}

/**
 * Reads the persisted recents list, newest first.
 * @param database - Open SQLite connection.
 * @returns The stored entries, or an empty list when unset or unreadable.
 */
export function readLinkedDirectoryRecents(
	database: DatabaseSync,
): readonly LinkedDirectoryRecentRow[] {
	const row = database
		.prepare(
			`SELECT value_json FROM settings
			 WHERE scope = ? AND scope_id = ? AND key = ?`,
		)
		.get(RECENTS_SCOPE, RECENTS_SCOPE_ID, RECENTS_KEY) as
		| { value_json: string }
		| undefined;

	if (!row) {
		return [];
	}

	try {
		const decoded: unknown = JSON.parse(row.value_json);
		if (!Array.isArray(decoded)) {
			return [];
		}
		return decoded
			.map(parseRow)
			.filter((entry): entry is LinkedDirectoryRecentRow => entry !== null);
	} catch {
		return [];
	}
}

/**
 * Replaces the persisted recents list wholesale.
 * @param input - Open SQLite connection and the entries to store, newest first.
 */
export function writeLinkedDirectoryRecents({
	database,
	entries,
}: {
	database: DatabaseSync;
	entries: readonly LinkedDirectoryRecentRow[];
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
			RECENTS_SCOPE,
			RECENTS_SCOPE_ID,
			RECENTS_KEY,
			JSON.stringify(entries),
			timestamp,
		);
}
