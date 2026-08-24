import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/**
 * What a memory is about. The vocabulary is deliberately small: a Concierge
 * that has to choose between fifteen kinds spends its judgement on filing
 * rather than on the fact it is filing.
 */
export type ConciergeMemoryKind =
	| 'decision'
	| 'note'
	| 'person'
	| 'project'
	| 'reference'
	| 'work-log';

/** Every recognised memory kind, in the order the schema declares them. */
export const CONCIERGE_MEMORY_KINDS: readonly ConciergeMemoryKind[] = [
	'project',
	'decision',
	'person',
	'reference',
	'work-log',
	'note',
];

/**
 * One indexed memory. The markdown file under `<root>/concierge/memory/` is the
 * source of truth; this row and the FTS index beside it are derived, so a lost
 * database rebuilds itself from disk.
 */
export interface ConciergeMemoryRow {
	body: string;
	contentHash: string;
	createdAt: string;
	fileMtimeMs: number;
	id: string;
	kind: ConciergeMemoryKind;
	projects: string[];
	relativePath: string;
	slug: string;
	summary: string;
	title: string;
	updatedAt: string;
}

/** Fields accepted when indexing a memory file. */
export interface UpsertConciergeMemoryInput {
	body: string;
	contentHash: string;
	fileMtimeMs: number;
	kind: ConciergeMemoryKind;
	projects?: string[];
	relativePath: string;
	slug: string;
	summary: string;
	title: string;
}

/** One search hit, with the snippet the match came from. */
export interface ConciergeMemoryHit {
	kind: ConciergeMemoryKind;
	relativePath: string;
	slug: string;
	snippet: string;
	summary: string;
	title: string;
}

/** Raw memory row as stored, with snake_case columns. */
interface MemoryRowShape {
	body: string;
	content_hash: string;
	created_at: string;
	file_mtime_ms: number;
	id: string;
	kind: ConciergeMemoryKind;
	projects_json: string;
	relative_path: string;
	slug: string;
	summary: string;
	title: string;
	updated_at: string;
}

const SELECT_MEMORY = `SELECT id, slug, relative_path, kind, title, summary, body,
	projects_json, content_hash, file_mtime_ms, created_at, updated_at
FROM concierge_memories`;

/**
 * Maps a stored memory row onto its domain shape.
 * @param row - Raw row read from SQLite.
 * @returns The memory in camelCase, with its project list parsed.
 */
function toMemoryRow(row: MemoryRowShape): ConciergeMemoryRow {
	return {
		body: row.body,
		contentHash: row.content_hash,
		createdAt: row.created_at,
		fileMtimeMs: row.file_mtime_ms,
		id: row.id,
		kind: row.kind,
		projects: parseProjects(row.projects_json),
		relativePath: row.relative_path,
		slug: row.slug,
		summary: row.summary,
		title: row.title,
		updatedAt: row.updated_at,
	};
}

/**
 * Parses the stored project list, returning an empty list on corrupt JSON.
 * @param raw - Stored JSON array.
 * @returns The project slugs the memory is filed under.
 */
function parseProjects(raw: string): string[] {
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter((entry): entry is string => typeof entry === 'string')
			: [];
	} catch {
		return [];
	}
}

/**
 * Narrows an arbitrary string to a recognised memory kind, defaulting to `note`
 * so a hand-edited file with a typo in its frontmatter still indexes.
 * @param value - Candidate kind read from frontmatter.
 * @returns A valid memory kind.
 */
export function coerceConciergeMemoryKind(
	value: string | undefined,
): ConciergeMemoryKind {
	return CONCIERGE_MEMORY_KINDS.includes(value as ConciergeMemoryKind)
		? (value as ConciergeMemoryKind)
		: 'note';
}

/**
 * Writes a memory and its FTS entry, replacing whatever is filed under the same
 * slug. Both writes share one transaction so the index can never describe a row
 * that is not there.
 * @param input - Database handle and the memory to index.
 * @returns The persisted memory row.
 */
export function upsertConciergeMemory({
	database,
	input,
}: {
	database: DatabaseSync;
	input: UpsertConciergeMemoryInput;
}): ConciergeMemoryRow {
	database.exec('BEGIN IMMEDIATE');
	try {
		const existing = database
			.prepare('SELECT id FROM concierge_memories WHERE slug = ?')
			.get(input.slug) as { id: string } | undefined;
		const id = existing?.id ?? randomUUID();
		const projects = JSON.stringify(input.projects ?? []);

		if (existing) {
			database
				.prepare(
					`UPDATE concierge_memories
						SET relative_path = ?, kind = ?, title = ?, summary = ?, body = ?,
							projects_json = ?, content_hash = ?, file_mtime_ms = ?,
							updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
						WHERE id = ?`,
				)
				.run(
					input.relativePath,
					input.kind,
					input.title,
					input.summary,
					input.body,
					projects,
					input.contentHash,
					input.fileMtimeMs,
					id,
				);
		} else {
			database
				.prepare(
					`INSERT INTO concierge_memories
						(id, slug, relative_path, kind, title, summary, body, projects_json,
						 content_hash, file_mtime_ms)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					id,
					input.slug,
					input.relativePath,
					input.kind,
					input.title,
					input.summary,
					input.body,
					projects,
					input.contentHash,
					input.fileMtimeMs,
				);
		}

		database
			.prepare('DELETE FROM concierge_memories_fts WHERE slug = ?')
			.run(input.slug);
		database
			.prepare(
				`INSERT INTO concierge_memories_fts (slug, title, summary, body)
					VALUES (?, ?, ?, ?)`,
			)
			.run(input.slug, input.title, input.summary, input.body);

		database.exec('COMMIT');
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}

	const row = getConciergeMemoryBySlug({ database, slug: input.slug });
	if (!row) {
		throw new Error(`Concierge memory ${input.slug} vanished after write`);
	}
	return row;
}

/**
 * Reads one memory by its slug.
 * @param database - Open SQLite connection.
 * @param slug - Memory slug, which is also its file basename.
 * @returns The memory, or null when nothing is filed under that slug.
 */
export function getConciergeMemoryBySlug({
	database,
	slug,
}: {
	database: DatabaseSync;
	slug: string;
}): ConciergeMemoryRow | null {
	const row = database.prepare(`${SELECT_MEMORY} WHERE slug = ?`).get(slug) as
		| MemoryRowShape
		| undefined;
	return row ? toMemoryRow(row) : null;
}

/**
 * Lists every indexed memory, most recently updated first.
 * @param database - Open SQLite connection.
 * @returns All memories in the index.
 */
export function listConciergeMemories({
	database,
}: {
	database: DatabaseSync;
}): ConciergeMemoryRow[] {
	return (
		database
			.prepare(`${SELECT_MEMORY} ORDER BY updated_at DESC`)
			.all() as unknown as MemoryRowShape[]
	).map(toMemoryRow);
}

/**
 * Drops a memory and its FTS entry.
 * @param database - Open SQLite connection.
 * @param slug - Memory slug to remove.
 * @returns True when a row was actually deleted.
 */
export function deleteConciergeMemory({
	database,
	slug,
}: {
	database: DatabaseSync;
	slug: string;
}): boolean {
	database.exec('BEGIN IMMEDIATE');
	try {
		const result = database
			.prepare('DELETE FROM concierge_memories WHERE slug = ?')
			.run(slug);
		database
			.prepare('DELETE FROM concierge_memories_fts WHERE slug = ?')
			.run(slug);
		database.exec('COMMIT');
		return Number(result.changes) > 0;
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}
}

/**
 * Full-text searches the memory index.
 *
 * The query is quoted as an FTS5 string literal rather than passed through, so
 * a Concierge searching for `NOT` or `repo:*` gets a term search instead of a
 * syntax error it cannot see the cause of.
 * @param input - Database handle, the search text, and a result cap.
 * @returns Ranked hits, best match first.
 */
export function searchConciergeMemories({
	database,
	limit = 10,
	query,
}: {
	database: DatabaseSync;
	limit?: number;
	query: string;
}): ConciergeMemoryHit[] {
	const match = toMatchExpression(query);
	if (!match) {
		return [];
	}

	const rows = database
		.prepare(
			`SELECT f.slug AS slug,
				snippet(concierge_memories_fts, 3, '', '', ' … ', 24) AS snippet,
				m.title AS title, m.summary AS summary, m.kind AS kind,
				m.relative_path AS relative_path
			FROM concierge_memories_fts f
			JOIN concierge_memories m ON m.slug = f.slug
			WHERE concierge_memories_fts MATCH ?
			ORDER BY rank
			LIMIT ?`,
		)
		.all(match, limit) as {
		kind: ConciergeMemoryKind;
		relative_path: string;
		slug: string;
		snippet: string;
		summary: string;
		title: string;
	}[];

	return rows.map((row) => ({
		kind: row.kind,
		relativePath: row.relative_path,
		slug: row.slug,
		snippet: row.snippet,
		summary: row.summary,
		title: row.title,
	}));
}

/**
 * Turns free text into an FTS5 MATCH expression of quoted terms joined by OR,
 * so ranking decides relevance rather than every word having to appear.
 * @param query - Raw search text from the caller.
 * @returns The MATCH expression, or null when the query has no usable term.
 */
function toMatchExpression(query: string): string | null {
	const terms = query
		.split(/[^\p{L}\p{N}_-]+/u)
		.map((term) => term.trim())
		.filter((term) => term.length > 0);
	return terms.length > 0
		? terms.map((term) => `"${term}"`).join(' OR ')
		: null;
}

/**
 * Rebuilds the FTS index from the memory rows, used after reconciliation notices
 * the index and the table have diverged.
 * @param database - Open SQLite connection.
 */
export function rebuildConciergeMemoryIndex({
	database,
}: {
	database: DatabaseSync;
}): void {
	database.exec('BEGIN IMMEDIATE');
	try {
		database.exec('DELETE FROM concierge_memories_fts');
		const insert = database.prepare(
			`INSERT INTO concierge_memories_fts (slug, title, summary, body)
				SELECT slug, title, summary, body FROM concierge_memories`,
		);
		insert.run();
		database.exec('COMMIT');
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}
}
