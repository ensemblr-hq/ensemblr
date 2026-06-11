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

/** Inputs for {@link selectRepositoryForArchive}. */
export interface SelectRepositoryForArchiveOptions {
	database: DatabaseSync;
	id: string;
}

/**
 * Returns the repository row projection used by the archive flow:
 * id, slug, name, path, archived_at. The raw row is returned so the
 * caller's type guards stay authoritative.
 */
export function selectRepositoryForArchive({
	database,
	id,
}: SelectRepositoryForArchiveOptions): unknown {
	return database
		.prepare(
			`SELECT
				id AS id,
				slug AS slug,
				name AS name,
				path AS path,
				archived_at AS archivedAt
			FROM repositories
			WHERE id = ?`,
		)
		.get(id);
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

/** Inputs for {@link stampRepositoryArchived}. */
export interface StampRepositoryArchivedOptions {
	archivedAt: string;
	database: DatabaseSync;
	id: string;
}

/**
 * Sets both `archived_at` and `updated_at` on a repository row so it enters
 * the archived lifecycle state.
 */
export function stampRepositoryArchived({
	archivedAt,
	database,
	id,
}: StampRepositoryArchivedOptions): void {
	database
		.prepare(
			`UPDATE repositories
				SET archived_at = ?, updated_at = ?
				WHERE id = ?`,
		)
		.run(archivedAt, archivedAt, id);
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

function isIdRow(row: unknown): row is { id: string } {
	return (
		typeof row === 'object' &&
		row !== null &&
		'id' in row &&
		typeof (row as { id: unknown }).id === 'string'
	);
}
