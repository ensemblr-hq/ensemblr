import type { DatabaseSync } from 'node:sqlite';

/**
 * The renderer's `localStorage`, as last mirrored into the main process, and
 * the origin the document that mirrored it was served from.
 *
 * The mirror exists because the renderer's preferences are keyed by the
 * document's *origin*: moving the packaged renderer off `file:` onto `app://`
 * orphans every one of them. Main is origin-blind, so a copy kept here survives
 * that move — see `docs/adr/0071-mirror-renderer-local-storage-into-sqlite.md`.
 */
export interface RendererStorageMirror {
	entries: Record<string, string>;
	/** Origin of the document the snapshot came from, or null when never written. */
	origin: string | null;
}

/** Sole row id of `renderer_storage_mirror`, which holds at most one snapshot. */
const MIRROR_ROW_ID = 'mirror';

/**
 * Narrows a decoded JSON blob to the string-to-string map `localStorage` is,
 * dropping anything a hand-edited or partially written row could carry.
 * @param decoded - The parsed `entries_json` payload.
 * @returns Every string-valued entry, in insertion order.
 */
function parseEntries(decoded: unknown): Record<string, string> {
	if (typeof decoded !== 'object' || decoded === null) {
		return {};
	}
	const entries: Record<string, string> = {};
	for (const [key, value] of Object.entries(decoded)) {
		if (typeof value === 'string') {
			entries[key] = value;
		}
	}
	return entries;
}

/**
 * Reads the mirrored renderer storage and the origin it was taken from.
 * @param database - Open SQLite connection.
 * @returns The mirrored entries (empty when never written) and their origin.
 */
export function readRendererStorageMirror(
	database: DatabaseSync,
): RendererStorageMirror {
	const row = database
		.prepare(
			`SELECT entries_json, origin FROM renderer_storage_mirror WHERE id = ?`,
		)
		.get(MIRROR_ROW_ID) as { entries_json: string; origin: string } | undefined;

	if (!row) {
		return { entries: {}, origin: null };
	}

	try {
		return {
			entries: parseEntries(JSON.parse(row.entries_json)),
			origin: row.origin,
		};
	} catch {
		return { entries: {}, origin: row.origin };
	}
}

/**
 * Replaces the mirrored renderer storage wholesale, so a key the renderer
 * deleted disappears here too, and records the origin it came from.
 * @param input - Open SQLite connection, the renderer's full `localStorage` contents, and its origin.
 */
export function writeRendererStorageMirror({
	database,
	entries,
	origin,
}: {
	database: DatabaseSync;
	entries: Record<string, string>;
	origin: string;
}): void {
	database
		.prepare(
			`INSERT INTO renderer_storage_mirror (id, entries_json, origin, updated_at)
			VALUES (?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				entries_json = excluded.entries_json,
				origin = excluded.origin,
				updated_at = excluded.updated_at`,
		)
		.run(
			MIRROR_ROW_ID,
			JSON.stringify(entries),
			origin,
			new Date().toISOString(),
		);
}

/**
 * Whether the mirror has already been replayed into a given origin. Per origin
 * rather than per install, so a later origin change gets its own seed instead
 * of finding the one marker already spent.
 * @param database - Open SQLite connection.
 * @param origin - Origin to check.
 * @returns True when this origin has been seeded before.
 */
export function hasSeededOrigin(
	database: DatabaseSync,
	origin: string,
): boolean {
	const row = database
		.prepare(`SELECT 1 FROM renderer_storage_seeded_origins WHERE origin = ?`)
		.get(origin);
	return row !== undefined;
}

/**
 * Records that the mirror has been replayed into an origin, which is what stops
 * a user who deliberately cleared that origin's storage from having it restored
 * on the next launch.
 * @param input - Open SQLite connection, the origin seeded, and the ISO timestamp to record.
 */
export function markRendererStorageSeeded({
	database,
	origin,
	seededAt,
}: {
	database: DatabaseSync;
	origin: string;
	seededAt: string;
}): void {
	database
		.prepare(
			`INSERT INTO renderer_storage_seeded_origins (origin, seeded_at)
			VALUES (?, ?)
			ON CONFLICT(origin) DO UPDATE SET seeded_at = excluded.seeded_at`,
		)
		.run(origin, seededAt);
}
