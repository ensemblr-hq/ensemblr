import type { DatabaseSync } from 'node:sqlite';

/**
 * Data-access functions for the `repositories` table.
 *
 * Domain services (`src/main/repository/`) must call these helpers instead of
 * issuing raw `database.prepare(...)` calls so the SQL surface stays auditable.
 * Transactional grouping stays in the domain layer.
 */

/** Inputs for {@link selectRepositoryIdByPath}. */
export interface SelectRepositoryIdByPathOptions {
	database: DatabaseSync;
	repositoryPath: string;
}

/** Returns the repository id whose `path` column matches the input, else `null`. */
export function selectRepositoryIdByPath({
	database,
	repositoryPath,
}: SelectRepositoryIdByPathOptions): string | null {
	const row = database
		.prepare('SELECT id FROM repositories WHERE path = ?')
		.get(repositoryPath);
	return isIdRow(row) ? row.id : null;
}

/** Inputs for {@link selectRepositoryIdByRemoteUrl}. */
export interface SelectRepositoryIdByRemoteUrlOptions {
	database: DatabaseSync;
	remoteUrl: string;
}

/**
 * Returns the first repository id whose `remote_url` column equals the input.
 * The caller normalises the URL before invoking; this helper preserves the
 * legacy `LIMIT 1` form so a legacy duplicate row does not break the check.
 */
export function selectRepositoryIdByRemoteUrl({
	database,
	remoteUrl,
}: SelectRepositoryIdByRemoteUrlOptions): string | null {
	const row = database
		.prepare('SELECT id FROM repositories WHERE remote_url = ? LIMIT 1')
		.get(remoteUrl);
	return isIdRow(row) ? row.id : null;
}

/** Inputs for {@link selectRepositoryIdBySlug}. */
export interface SelectRepositoryIdBySlugOptions {
	database: DatabaseSync;
	slug: string;
}

/** Returns the repository id whose `slug` column matches the input, else `null`. */
export function selectRepositoryIdBySlug({
	database,
	slug,
}: SelectRepositoryIdBySlugOptions): string | null {
	const row = database
		.prepare('SELECT id FROM repositories WHERE slug = ?')
		.get(slug);
	return isIdRow(row) ? row.id : null;
}

/** Shape returned by repository slug+path lookups used by adoption. */
export interface RepositoryLookupRow {
	defaultBranch: string | null;
	id: string;
	path: string;
	slug: string;
}

/** Inputs for {@link selectRepositoryLookupByPath}. */
export interface SelectRepositoryLookupByPathOptions {
	database: DatabaseSync;
	repositoryPath: string;
}

/**
 * Loads the slim `(id, slug, defaultBranch)` projection used by the
 * shared-root adoption flow when matching a discovered repository folder.
 * Returns the raw row so the caller's type guards stay authoritative.
 */
export function selectRepositoryLookupByPath({
	database,
	repositoryPath,
}: SelectRepositoryLookupByPathOptions): unknown {
	return database
		.prepare(
			'SELECT id, slug, default_branch AS defaultBranch FROM repositories WHERE path = ?',
		)
		.get(repositoryPath);
}

/** Inputs for {@link selectRepositoryLookupBySlug}. */
export interface SelectRepositoryLookupBySlugOptions {
	database: DatabaseSync;
	slug: string;
}

/**
 * Loads the slim `(id, slug, path, defaultBranch)` projection used by adoption
 * when matching a discovered repository's slug. Returns the raw row so the
 * caller's type guards stay authoritative.
 */
export function selectRepositoryLookupBySlug({
	database,
	slug,
}: SelectRepositoryLookupBySlugOptions): unknown {
	return database
		.prepare(
			'SELECT id, path, slug, default_branch AS defaultBranch FROM repositories WHERE slug = ?',
		)
		.get(slug);
}

/** Inputs for {@link selectRepositoryMetadataJson}. */
export interface SelectRepositoryMetadataJsonOptions {
	database: DatabaseSync;
	id: string;
}

/** Returns `metadata_json` for a repository row, or `null` when absent. */
export function selectRepositoryMetadataJson({
	database,
	id,
}: SelectRepositoryMetadataJsonOptions): string | null {
	const row = database
		.prepare(
			'SELECT metadata_json AS metadataJson FROM repositories WHERE id = ?',
		)
		.get(id) as { metadataJson: string } | undefined;
	return row?.metadataJson ?? null;
}

/** Inputs for {@link selectRepositoryWithDefaultsById}. */
export interface SelectRepositoryWithDefaultsByIdOptions {
	database: DatabaseSync;
	id: string;
}

/**
 * Returns the repository row projection used by the create-workspace service:
 * id, slug, path, and default_branch. The raw row is forwarded so the
 * caller's type guards stay authoritative.
 */
export function selectRepositoryWithDefaultsById({
	database,
	id,
}: SelectRepositoryWithDefaultsByIdOptions): unknown {
	return database
		.prepare(
			'SELECT id, slug, path, default_branch FROM repositories WHERE id = ?',
		)
		.get(id);
}

/** Inputs for {@link selectRepositoryPathById}. */
export interface SelectRepositoryPathByIdOptions {
	database: DatabaseSync;
	id: string;
}

/**
 * Reads a repository's root clone path, which callers need before touching any
 * of its on-disk files.
 * @param options - Database handle and repository id.
 * @returns The absolute path, or null when the repository is unknown.
 */
export function selectRepositoryPathById({
	database,
	id,
}: SelectRepositoryPathByIdOptions): string | null {
	const row = database
		.prepare('SELECT path FROM repositories WHERE id = ?')
		.get(id);

	if (!row || typeof row !== 'object') {
		return null;
	}

	const { path } = row as Record<string, unknown>;

	return typeof path === 'string' && path ? path : null;
}

/** A repository's id paired with its root clone path. */
export interface RepositoryPathRow {
	id: string;
	path: string;
}

/**
 * Lists every live repository's id and root clone path, for passes that have to
 * touch each repository's on-disk files. Archived repositories are skipped
 * because their checkouts may no longer exist.
 * @param options - Database handle.
 * @returns One row per live repository.
 */
export function selectLiveRepositoryPaths({
	database,
}: {
	database: DatabaseSync;
}): RepositoryPathRow[] {
	const rows = database
		.prepare(
			'SELECT id, path FROM repositories WHERE archived_at IS NULL ORDER BY id',
		)
		.all() as { id: unknown; path: unknown }[];

	return rows.flatMap((row) =>
		typeof row.id === 'string' && typeof row.path === 'string' && row.path
			? [{ id: row.id, path: row.path }]
			: [],
	);
}

/**
 * How every listing of live repositories orders them.
 *
 * Shared rather than repeated because two queries have to agree on it: the
 * sidebar's navigation snapshot and the project roster `ensemblr_list_projects`
 * hands the Concierge. A roster ordered differently from the sidebar the user
 * reads it against is a needless discrepancy, and one copied clause drifts the
 * moment the other is edited.
 * @param alias - Table alias to qualify the columns with, when the query joins.
 * @returns The `ORDER BY` clause, keyword included.
 */
export function liveRepositoryOrderClause(alias = ''): string {
	const column = (name: string): string => (alias ? `${alias}.${name}` : name);
	return `ORDER BY lower(${column('name')}), lower(${column('slug')}), ${column('id')}`;
}

/** One project row, with the live workspaces cut from it already counted. */
export interface ProjectListingRow {
	defaultBranch: string | null;
	id: string;
	name: string;
	path: string;
	slug: string;
	workspaceCount: number;
}

/**
 * Lists every live repository with the number of live workspaces cut from it,
 * in the sidebar's own order via {@link liveRepositoryOrderClause}. Counted in
 * SQL rather than by the caller, because the only alternative is reading every
 * workspace row to group it back down to one integer per project.
 * @param options - Database handle.
 * @returns One row per live repository, in name order.
 */
export function listProjectRows({
	database,
}: {
	database: DatabaseSync;
}): ProjectListingRow[] {
	const rows = database
		.prepare(
			`SELECT
				r.id AS id,
				r.slug AS slug,
				r.name AS name,
				r.path AS path,
				r.default_branch AS defaultBranch,
				COUNT(w.id) AS workspaceCount
			FROM repositories r
			LEFT JOIN workspaces w
				ON w.repository_id = r.id
				AND w.archived_at IS NULL
			WHERE r.archived_at IS NULL
			GROUP BY r.id
			${liveRepositoryOrderClause('r')}`,
		)
		.all();

	return rows.flatMap((row) => {
		const project = toProjectListingRow(row);
		return project ? [project] : [];
	});
}

/**
 * Narrows one grouped project row, dropping any whose identity columns are not
 * the strings the schema promises.
 * @param row - Value returned from the listing query.
 * @returns The typed row, or null when it is malformed.
 */
function toProjectListingRow(row: unknown): ProjectListingRow | null {
	if (typeof row !== 'object' || row === null) {
		return null;
	}
	const { defaultBranch, id, name, path, slug, workspaceCount } = row as Record<
		string,
		unknown
	>;
	if (typeof id !== 'string' || typeof path !== 'string') {
		return null;
	}
	return {
		defaultBranch: typeof defaultBranch === 'string' ? defaultBranch : null,
		id,
		name: typeof name === 'string' ? name : id,
		path,
		slug: typeof slug === 'string' ? slug : id,
		workspaceCount: typeof workspaceCount === 'number' ? workspaceCount : 0,
	};
}

/** Inputs for {@link selectRepositoryForDelete}. */
export interface SelectRepositoryForDeleteOptions {
	database: DatabaseSync;
	id: string;
}

/**
 * Returns the repository row projection used by the destructive delete flow:
 * id, name, path, slug.
 */
export function selectRepositoryForDelete({
	database,
	id,
}: SelectRepositoryForDeleteOptions): unknown {
	return database
		.prepare(
			`SELECT id AS id, name AS name, path AS path, slug AS slug
			FROM repositories
			WHERE id = ?`,
		)
		.get(id);
}

/** Inputs for {@link insertRepositoryRow}. */
export interface InsertRepositoryRowOptions {
	database: DatabaseSync;
	defaultBranch: string | null;
	id: string;
	metadataJson: string;
	name: string;
	path: string;
	remoteUrl: string;
	slug: string;
	timestamp: string;
}

/**
 * Inserts a `repositories` row using the canonical column list. Used by both
 * the explicit register service and the shared-root adoption flow.
 */
export function insertRepositoryRow({
	database,
	defaultBranch,
	id,
	metadataJson,
	name,
	path,
	remoteUrl,
	slug,
	timestamp,
}: InsertRepositoryRowOptions): void {
	database
		.prepare(
			`INSERT INTO repositories (
				id,
				slug,
				name,
				path,
				default_branch,
				created_at,
				updated_at,
				metadata_json,
				remote_url
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			id,
			slug,
			name,
			path,
			defaultBranch,
			timestamp,
			timestamp,
			metadataJson,
			remoteUrl,
		);
}

/** Inputs for {@link refreshRepositoryAdoptionRow}. */
export interface RefreshRepositoryAdoptionRowOptions {
	database: DatabaseSync;
	defaultBranch: string | null;
	id: string;
	metadataJson: string;
	timestamp: string;
}

/**
 * Updates `updated_at`, conditionally bumps `default_branch` when a fresh
 * value is available, and overwrites `metadata_json` for the shared-root
 * adoption refresh path.
 */
export function refreshRepositoryAdoptionRow({
	database,
	defaultBranch,
	id,
	metadataJson,
	timestamp,
}: RefreshRepositoryAdoptionRowOptions): void {
	database
		.prepare(
			`UPDATE repositories
				SET updated_at = ?,
					default_branch = COALESCE(?, default_branch),
					metadata_json = ?
				WHERE id = ?`,
		)
		.run(timestamp, defaultBranch, metadataJson, id);
}

/** Inputs for {@link updateRepositoryMetadataJson}. */
export interface UpdateRepositoryMetadataJsonOptions {
	database: DatabaseSync;
	id: string;
	metadataJson: string;
}

/**
 * Overwrites a repository row's `metadata_json` without touching any other
 * column. Used by the shared-root reconciler to record `missingSince` tags.
 */
export function updateRepositoryMetadataJson({
	database,
	id,
	metadataJson,
}: UpdateRepositoryMetadataJsonOptions): void {
	database
		.prepare('UPDATE repositories SET metadata_json = ? WHERE id = ?')
		.run(metadataJson, id);
}

/** Inputs for {@link deleteRepositoryRowById}. */
export interface DeleteRepositoryRowByIdOptions {
	database: DatabaseSync;
	id: string;
}

/** Removes a single repository row. */
export function deleteRepositoryRowById({
	database,
	id,
}: DeleteRepositoryRowByIdOptions): void {
	database.prepare('DELETE FROM repositories WHERE id = ?').run(id);
}

/** Inputs for {@link listRepositoryRowsByPathPrefix}. */
export interface ListRepositoryRowsByPathPrefixOptions {
	database: DatabaseSync;
	pathPrefix: string;
}

/**
 * Returns repository rows whose `path` begins with `pathPrefix`. Used by the
 * shared-root stale detector. The `LIKE ? || '%'` pattern preserves the
 * legacy index-friendly form.
 */
export function listRepositoryRowsByPathPrefix({
	database,
	pathPrefix,
}: ListRepositoryRowsByPathPrefixOptions): unknown[] {
	return database
		.prepare(
			"SELECT id, path, metadata_json AS metadataJson FROM repositories WHERE path LIKE ? || '%'",
		)
		.all(pathPrefix);
}

/**
 * Type guard narrowing an unknown SQLite row to one exposing a string `id`.
 * @param row - Value returned from a SQLite query
 * @returns True when the row has a string `id`
 */
function isIdRow(row: unknown): row is { id: string } {
	return (
		typeof row === 'object' &&
		row !== null &&
		'id' in row &&
		typeof (row as { id: unknown }).id === 'string'
	);
}
