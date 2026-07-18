import type { DatabaseSync } from 'node:sqlite';

/**
 * Data-access functions for the `workspaces` table.
 *
 * Domain services (`src/main/repository/`) must call these helpers instead of
 * issuing raw `database.prepare(...)` calls so the SQL surface stays auditable
 * and column drift can be caught in one place. Transactional grouping stays in
 * the domain layer — these helpers run single statements and assume the caller
 * wraps related ops in `withTransaction` when needed.
 */

/** Inputs for {@link getWorkspacePathById}. */
export interface GetWorkspacePathByIdOptions {
	database: DatabaseSync;
	workspaceId: string;
}

/**
 * Returns the on-disk path for a workspace row, or `null` when the row does
 * not exist. Used by IPC handlers that need to resolve the workspace cwd
 * without pulling in the full navigation snapshot.
 */
export function getWorkspacePathById({
	database,
	workspaceId,
}: GetWorkspacePathByIdOptions): string | null {
	const row = database
		.prepare(`SELECT path FROM workspaces WHERE id = ?`)
		.get(workspaceId) as { path: string } | undefined;
	return row?.path ?? null;
}

/** Inputs for {@link selectWorkspaceIdByPath}. */
export interface SelectWorkspaceIdByPathOptions {
	database: DatabaseSync;
	workspacePath: string;
}

/**
 * Returns the workspace id whose `path` column matches `workspacePath`, or
 * `null` when nothing matches.
 */
export function selectWorkspaceIdByPath({
	database,
	workspacePath,
}: SelectWorkspaceIdByPathOptions): string | null {
	const row = database
		.prepare('SELECT id FROM workspaces WHERE path = ?')
		.get(workspacePath);
	return isIdRow(row) ? row.id : null;
}

/** Inputs for {@link selectWorkspaceSlugCollision}. */
export interface SelectWorkspaceSlugCollisionOptions {
	database: DatabaseSync;
	repositoryId: string;
	slug: string;
}

/**
 * Returns `true` when a workspace with `slug` already exists inside the
 * repository. Used by the create-workspace service to allocate a fresh slug.
 */
export function workspaceSlugExists({
	database,
	repositoryId,
	slug,
}: SelectWorkspaceSlugCollisionOptions): boolean {
	const row = database
		.prepare('SELECT id FROM workspaces WHERE repository_id = ? AND slug = ?')
		.get(repositoryId, slug);
	return isIdRow(row);
}

/** Inputs for {@link workspaceNameCollisionExists}. */
export interface WorkspaceNameCollisionOptions {
	database: DatabaseSync;
	excludeId: string;
	name: string;
	repositoryId: string;
}

/**
 * Returns `true` when another workspace in the same repository already uses
 * `name`. The active workspace id is excluded so a no-op rename does not
 * collide with itself.
 */
export function workspaceNameCollisionExists({
	database,
	excludeId,
	name,
	repositoryId,
}: WorkspaceNameCollisionOptions): boolean {
	const row = database
		.prepare(
			'SELECT id FROM workspaces WHERE repository_id = ? AND name = ? AND id != ?',
		)
		.get(repositoryId, name, excludeId);
	return isIdRow(row);
}

/** Inputs for {@link selectWorkspaceMetadataJson}. */
export interface SelectWorkspaceMetadataJsonOptions {
	database: DatabaseSync;
	id: string;
}

/** Returns `metadata_json` for the workspace row, or `null` when absent. */
export function selectWorkspaceMetadataJson({
	database,
	id,
}: SelectWorkspaceMetadataJsonOptions): string | null {
	const row = database
		.prepare(
			'SELECT metadata_json AS metadataJson FROM workspaces WHERE id = ?',
		)
		.get(id) as { metadataJson: string } | undefined;
	return row?.metadataJson ?? null;
}

/** Inputs for {@link insertWorkspaceRow}. */
export interface InsertWorkspaceRowOptions {
	baseBranch: string | null;
	branchName: string | null;
	database: DatabaseSync;
	id: string;
	metadataJson: string;
	name: string;
	path: string;
	repositoryId: string;
	slug: string;
	timestamp: string;
}

/**
 * Inserts a `workspaces` row using the canonical column list. Callers wrap
 * this in their own transaction when grouping with sibling writes.
 */
export function insertWorkspaceRow({
	baseBranch,
	branchName,
	database,
	id,
	metadataJson,
	name,
	path,
	repositoryId,
	slug,
	timestamp,
}: InsertWorkspaceRowOptions): void {
	database
		.prepare(
			`INSERT INTO workspaces (
				id,
				repository_id,
				slug,
				name,
				path,
				branch_name,
				base_branch,
				created_at,
				updated_at,
				metadata_json
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			id,
			repositoryId,
			slug,
			name,
			path,
			branchName,
			baseBranch,
			timestamp,
			timestamp,
			metadataJson,
		);
}

/** Inputs for {@link updateWorkspaceRenameRow}. */
export interface UpdateWorkspaceRenameRowOptions {
	branchName: string | null;
	database: DatabaseSync;
	id: string;
	metadataJson: string;
	name: string;
	timestamp: string;
}

/**
 * Patches the workspace row to reflect a rename, bumping both `updated_at`
 * and the supplied `metadata_json` (which the caller stamps with the rename
 * audit fields).
 */
export function updateWorkspaceRenameRow({
	branchName,
	database,
	id,
	metadataJson,
	name,
	timestamp,
}: UpdateWorkspaceRenameRowOptions): void {
	database
		.prepare(
			`UPDATE workspaces
				SET name = ?,
					branch_name = ?,
					updated_at = ?,
					metadata_json = ?
				WHERE id = ?`,
		)
		.run(name, branchName, timestamp, metadataJson, id);
}

/** Inputs for {@link stampWorkspaceArchived}. */
export interface StampWorkspaceArchivedOptions {
	archivedAt: string;
	database: DatabaseSync;
	id: string;
}

/**
 * Stamps `workspaces.archived_at` and `updated_at` to the same timestamp so
 * the row enters the archived lifecycle state.
 */
export function stampWorkspaceArchived({
	archivedAt,
	database,
	id,
}: StampWorkspaceArchivedOptions): void {
	database
		.prepare(
			`UPDATE workspaces
				SET archived_at = ?, updated_at = ?
				WHERE id = ?`,
		)
		.run(archivedAt, archivedAt, id);
}

/** Inputs for {@link clearWorkspaceArchived}. */
export interface ClearWorkspaceArchivedOptions {
	database: DatabaseSync;
	id: string;
	unarchivedAt: string;
}

/**
 * NULLs `workspaces.archived_at` and bumps `updated_at` so the row leaves the
 * archived lifecycle state.
 */
export function clearWorkspaceArchived({
	database,
	id,
	unarchivedAt,
}: ClearWorkspaceArchivedOptions): void {
	database
		.prepare(
			`UPDATE workspaces
				SET archived_at = NULL, updated_at = ?
				WHERE id = ?`,
		)
		.run(unarchivedAt, id);
}

/** Inputs for {@link updateWorkspaceMetadataJson}. */
export interface UpdateWorkspaceMetadataJsonOptions {
	database: DatabaseSync;
	id: string;
	metadataJson: string;
}

/**
 * Overwrites a workspace row's `metadata_json` without touching any other
 * column. Used by the shared-root reconciler to record `missingSince` tags.
 */
export function updateWorkspaceMetadataJson({
	database,
	id,
	metadataJson,
}: UpdateWorkspaceMetadataJsonOptions): void {
	database
		.prepare('UPDATE workspaces SET metadata_json = ? WHERE id = ?')
		.run(metadataJson, id);
}

/** Inputs for {@link refreshWorkspaceAdoptionRow}. */
export interface RefreshWorkspaceAdoptionRowOptions {
	branchName: string | null;
	database: DatabaseSync;
	id: string;
	metadataJson: string;
	timestamp: string;
}

/**
 * Refreshes an existing workspace row's `branch_name` (when probe provides one)
 * and `metadata_json` so the shared-root adoption flow can record
 * `lastSeenAt` without overwriting the other branch state.
 */
export function refreshWorkspaceAdoptionRow({
	branchName,
	database,
	id,
	metadataJson,
	timestamp,
}: RefreshWorkspaceAdoptionRowOptions): void {
	database
		.prepare(
			`UPDATE workspaces
				SET updated_at = ?,
					branch_name = COALESCE(?, branch_name),
					metadata_json = ?
				WHERE id = ?`,
		)
		.run(timestamp, branchName, metadataJson, id);
}

/** Inputs for {@link deleteWorkspaceRowById}. */
export interface DeleteWorkspaceRowByIdOptions {
	database: DatabaseSync;
	id: string;
}

/**
 * Removes a single workspace row by id. Callers are expected to wrap this in
 * a transaction when grouping with other writes.
 */
export function deleteWorkspaceRowById({
	database,
	id,
}: DeleteWorkspaceRowByIdOptions): void {
	database.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
}

/** Inputs for {@link deleteWorkspaceRowsByRepository}. */
export interface DeleteWorkspaceRowsByRepositoryOptions {
	database: DatabaseSync;
	repositoryId: string;
}

/**
 * Removes every workspace row belonging to `repositoryId`. Wrapped by the
 * repository delete service inside a transaction that also drops the parent
 * `repositories` row.
 */
export function deleteWorkspaceRowsByRepository({
	database,
	repositoryId,
}: DeleteWorkspaceRowsByRepositoryOptions): void {
	database
		.prepare('DELETE FROM workspaces WHERE repository_id = ?')
		.run(repositoryId);
}

/** Inputs for {@link selectWorkspaceWithRepositoryById}. */
export interface SelectWorkspaceWithRepositoryByIdOptions {
	database: DatabaseSync;
	workspaceId: string;
}

/**
 * Joined `workspaces` x `repositories` row used by archive / rename / delete
 * flows. Returned shape mirrors the legacy domain query so the consumer's
 * type guards can stay unchanged.
 */
export function selectWorkspaceWithRepositoryById({
	database,
	workspaceId,
}: SelectWorkspaceWithRepositoryByIdOptions): unknown {
	return database
		.prepare(
			`SELECT
				w.id AS id,
				w.slug AS slug,
				w.repository_id AS repositoryId,
				w.name AS name,
				w.path AS path,
				w.branch_name AS branchName,
				w.base_branch AS baseBranch,
				w.archived_at AS archivedAt,
				w.created_at AS createdAt,
				w.metadata_json AS metadataJson,
				r.path AS repositoryPath,
				r.name AS repositoryName,
				r.slug AS repositorySlug
			FROM workspaces w
			INNER JOIN repositories r ON r.id = w.repository_id
			WHERE w.id = ?`,
		)
		.get(workspaceId);
}

/** Inputs for {@link selectWorkspaceEnvironmentJoinById}. */
export interface SelectWorkspaceEnvironmentJoinByIdOptions {
	database: DatabaseSync;
	workspaceId: string;
}

/**
 * Projection of the workspace + repository join used by workspace environment
 * assembly: identity, paths, branch lineage, the repository default branch,
 * and metadata (which carries the persisted port).
 */
export function selectWorkspaceEnvironmentJoinById({
	database,
	workspaceId,
}: SelectWorkspaceEnvironmentJoinByIdOptions): unknown {
	return database
		.prepare(
			`SELECT
				w.id AS id,
				w.slug AS slug,
				w.repository_id AS repositoryId,
				w.name AS name,
				w.path AS path,
				w.branch_name AS branchName,
				w.base_branch AS baseBranch,
				w.archived_at AS archivedAt,
				w.metadata_json AS metadataJson,
				r.path AS repositoryPath,
				r.name AS repositoryName,
				r.slug AS repositorySlug,
				r.default_branch AS repositoryDefaultBranch
			FROM workspaces w
			INNER JOIN repositories r ON r.id = w.repository_id
			WHERE w.id = ?`,
		)
		.get(workspaceId);
}

/** `id` + worktree `path` for one non-archived workspace. */
export interface ActiveWorkspacePathRow {
	id: string;
	path: string;
}

/**
 * Returns `id` + worktree `path` for every non-archived workspace. Used by the
 * PR-status sweeper to refresh each workspace's cached GitHub snapshot.
 * @param options - The open database connection.
 * @returns One row per active workspace.
 */
export function listActiveWorkspacePathRows({
	database,
}: {
	database: DatabaseSync;
}): ActiveWorkspacePathRow[] {
	return database
		.prepare(
			`SELECT id AS id, path AS path
			FROM workspaces
			WHERE archived_at IS NULL`,
		)
		.all() as unknown as ActiveWorkspacePathRow[];
}

/** Inputs for {@link listActiveWorkspaceMetadataRows}. */
export interface ListActiveWorkspaceMetadataRowsOptions {
	database: DatabaseSync;
}

/**
 * Returns `id` + `metadata_json` for every non-archived workspace. Used by the
 * port allocator to compute the set of ports already held by active siblings.
 */
export function listActiveWorkspaceMetadataRows({
	database,
}: ListActiveWorkspaceMetadataRowsOptions): unknown[] {
	return database
		.prepare(
			`SELECT id AS id, metadata_json AS metadataJson
			FROM workspaces
			WHERE archived_at IS NULL`,
		)
		.all();
}

/** Inputs for {@link selectDeleteWorkspaceWithRepositoryById}. */
export interface SelectDeleteWorkspaceWithRepositoryByIdOptions {
	database: DatabaseSync;
	workspaceId: string;
}

/**
 * Narrow projection of the workspace+repository join used by the destructive
 * delete service — it only needs the worktree path, branch name, and parent
 * repository path.
 */
export function selectDeleteWorkspaceWithRepositoryById({
	database,
	workspaceId,
}: SelectDeleteWorkspaceWithRepositoryByIdOptions): unknown {
	return database
		.prepare(
			`SELECT
				w.id AS id,
				w.repository_id AS repositoryId,
				w.name AS name,
				w.path AS path,
				w.branch_name AS branchName,
				r.path AS repositoryPath
			FROM workspaces w
			INNER JOIN repositories r ON r.id = w.repository_id
			WHERE w.id = ?`,
		)
		.get(workspaceId);
}

/** Inputs for {@link selectArchivedWorkspaceJoinById}. */
export interface SelectArchivedWorkspaceJoinByIdOptions {
	database: DatabaseSync;
	workspaceId: string;
}

/**
 * Full `workspaces` + `repositories` + most-recent `archive_records` join
 * needed by the unarchive flow. The latest archive row is resolved with a
 * correlated subquery so the worktree can be recreated from the original
 * `base_branch` and `archived_context_path`.
 */
export function selectArchivedWorkspaceJoinById({
	database,
	workspaceId,
}: SelectArchivedWorkspaceJoinByIdOptions): unknown {
	return database
		.prepare(
			`SELECT
				w.id AS id,
				w.slug AS slug,
				w.repository_id AS repositoryId,
				w.name AS name,
				w.path AS path,
				w.branch_name AS branchName,
				w.archived_at AS archivedAt,
				r.path AS repositoryPath,
				r.name AS repositoryName,
				r.slug AS repositorySlug,
				a.id AS archiveRecordId,
				a.base_branch AS baseBranch,
				a.archived_context_path AS archivedContextPath,
				a.branch_cleanup AS branchCleanupRaw
			FROM workspaces w
			INNER JOIN repositories r ON r.id = w.repository_id
			LEFT JOIN archive_records a
				ON a.workspace_id = w.id
				AND a.record_type = 'workspace'
				AND a.id = (
					SELECT id FROM archive_records
					WHERE workspace_id = w.id AND record_type = 'workspace'
					ORDER BY archived_at DESC
					LIMIT 1
				)
			WHERE w.id = ?`,
		)
		.get(workspaceId);
}

/** Inputs for {@link selectDeleteArchivedWorkspaceJoinById}. */
export interface SelectDeleteArchivedWorkspaceJoinByIdOptions {
	database: DatabaseSync;
	workspaceId: string;
}

/**
 * Narrow projection of the archived workspace join used by the
 * `delete-from-archive` service. Excludes columns the unarchive flow needs
 * (slug, repository id, repositoryName, repositorySlug) to keep the result
 * shape minimal for that consumer.
 */
export function selectDeleteArchivedWorkspaceJoinById({
	database,
	workspaceId,
}: SelectDeleteArchivedWorkspaceJoinByIdOptions): unknown {
	return database
		.prepare(
			`SELECT
				w.id AS id,
				w.name AS name,
				w.path AS path,
				w.branch_name AS branchName,
				w.archived_at AS archivedAt,
				r.path AS repositoryPath,
				a.archived_context_path AS archivedContextPath,
				a.branch_cleanup AS branchCleanupRaw
			FROM workspaces w
			INNER JOIN repositories r ON r.id = w.repository_id
			LEFT JOIN archive_records a
				ON a.workspace_id = w.id
				AND a.record_type = 'workspace'
				AND a.id = (
					SELECT id FROM archive_records
					WHERE workspace_id = w.id AND record_type = 'workspace'
					ORDER BY archived_at DESC
					LIMIT 1
				)
			WHERE w.id = ?`,
		)
		.get(workspaceId);
}

/** Inputs for {@link listArchivedWorkspaceRowsByRepository}. */
export interface ListArchivedWorkspaceRowsByRepositoryOptions {
	database: DatabaseSync;
	repositoryId: string;
}

/**
 * Returns every archived workspace under `repositoryId`, joined with the most
 * recent matching `archive_records` row, ordered by archive timestamp desc.
 * The shape matches what the legacy domain query produced so the existing
 * `toListEntry` projector can stay unchanged.
 */
export function listArchivedWorkspaceRowsByRepository({
	database,
	repositoryId,
}: ListArchivedWorkspaceRowsByRepositoryOptions): unknown[] {
	return database
		.prepare(
			`SELECT
				w.id AS id,
				w.slug AS slug,
				w.repository_id AS repositoryId,
				w.name AS name,
				w.path AS path,
				w.branch_name AS branchName,
				w.archived_at AS archivedAt,
				a.id AS archiveRecordId,
				a.base_branch AS baseBranch,
				a.archived_context_path AS archivedContextPath,
				a.branch_cleanup AS branchCleanupRaw
			FROM workspaces w
			LEFT JOIN archive_records a
				ON a.workspace_id = w.id
				AND a.record_type = 'workspace'
				AND a.id = (
					SELECT id FROM archive_records
					WHERE workspace_id = w.id AND record_type = 'workspace'
					ORDER BY archived_at DESC
					LIMIT 1
				)
			WHERE w.repository_id = ? AND w.archived_at IS NOT NULL
			ORDER BY w.archived_at DESC`,
		)
		.all(repositoryId);
}

/**
 * Returns every workspace across all repositories — active and archived —
 * joined with the parent repository (for the display name) and the most recent
 * matching `archive_records` row (for base branch + branch-cleanup state, used
 * to gate the Unarchive action). Ordered by last activity (with `id` as a
 * stable tiebreaker so equal timestamps don't reshuffle between loads) so the
 * History screen can group newest-first. Mirrors the archive-record join in
 * {@link listArchivedWorkspaceRowsByRepository} but drops the archived filter
 * and the repository scope.
 */
export function listAllWorkspaceRows({
	database,
}: {
	database: DatabaseSync;
}): unknown[] {
	return database
		.prepare(
			`SELECT
				w.id AS id,
				w.slug AS slug,
				w.repository_id AS repositoryId,
				w.name AS name,
				w.path AS path,
				w.branch_name AS branchName,
				w.created_at AS createdAt,
				w.updated_at AS updatedAt,
				w.archived_at AS archivedAt,
				r.name AS repositoryName,
				a.base_branch AS baseBranch,
				a.branch_cleanup AS branchCleanupRaw
			FROM workspaces w
			INNER JOIN repositories r ON r.id = w.repository_id
			LEFT JOIN archive_records a
				ON a.workspace_id = w.id
				AND a.record_type = 'workspace'
				AND a.id = (
					SELECT id FROM archive_records
					WHERE workspace_id = w.id AND record_type = 'workspace'
					ORDER BY archived_at DESC
					LIMIT 1
				)
			ORDER BY w.updated_at DESC, w.id DESC`,
		)
		.all();
}

/**
 * Returns `{ id, branchName }` for every active (non-archived) workspace in a
 * repository, so the create-from-source picker can mark branches that already
 * back a workspace and offer "Open" instead of forking a duplicate.
 */
export function listActiveWorkspaceBranchRowsByRepository({
	database,
	repositoryId,
}: {
	database: DatabaseSync;
	repositoryId: string;
}): unknown[] {
	return database
		.prepare(
			`SELECT
				id AS id,
				branch_name AS branchName
			FROM workspaces
			WHERE repository_id = ? AND archived_at IS NULL`,
		)
		.all(repositoryId);
}

/** A workspace's display name paired with its immutable slug. */
export interface WorkspaceNameSlugRow {
	name: string;
	slug: string;
}

/**
 * Returns `{ name, slug }` for every workspace in a repository, active or
 * archived. The placeholder-name picker uses this to skip composer surnames
 * already taken by a live or archived workspace. Because `slug` is fixed at
 * creation and never rewritten on rename, a workspace originally seeded "Bach"
 * then renamed still exposes `slug: "bach"`, so matching against slugs also
 * excludes names used prior to a rename.
 */
export function listWorkspaceNameSlugRowsByRepository({
	database,
	repositoryId,
}: {
	database: DatabaseSync;
	repositoryId: string;
}): WorkspaceNameSlugRow[] {
	return database
		.prepare(
			`SELECT
				name AS name,
				slug AS slug
			FROM workspaces
			WHERE repository_id = ?`,
		)
		.all(repositoryId) as unknown as WorkspaceNameSlugRow[];
}

/** Options for listing a repository's workspace id rows. */
export interface ListWorkspaceIdsByRepositoryOptions {
	database: DatabaseSync;
	repositoryId: string;
}

/**
 * Returns the rows the repository archive cascade needs: per-workspace id,
 * name, and `archived_at` so the service can skip already-archived workspaces.
 */
export function listWorkspaceIdsByRepository({
	database,
	repositoryId,
}: ListWorkspaceIdsByRepositoryOptions): unknown[] {
	return database
		.prepare(
			`SELECT
				id AS id,
				name AS name,
				archived_at AS archivedAt
			FROM workspaces
			WHERE repository_id = ?
			ORDER BY created_at`,
		)
		.all(repositoryId);
}

/** Inputs for {@link listWorkspaceDeletionRowsByRepository}. */
export interface ListWorkspaceDeletionRowsByRepositoryOptions {
	database: DatabaseSync;
	repositoryId: string;
}

/**
 * Returns the rows the repository delete service needs to wipe each workspace:
 * id, name, path, and branch_name.
 */
export function listWorkspaceDeletionRowsByRepository({
	database,
	repositoryId,
}: ListWorkspaceDeletionRowsByRepositoryOptions): unknown[] {
	return database
		.prepare(
			`SELECT
				id AS id,
				name AS name,
				path AS path,
				branch_name AS branchName
			FROM workspaces
			WHERE repository_id = ?`,
		)
		.all(repositoryId);
}

/** Inputs for {@link listWorkspaceRowsByPathPrefix}. */
export interface ListWorkspaceRowsByPathPrefixOptions {
	database: DatabaseSync;
	pathPrefix: string;
}

/**
 * Returns workspace rows whose `path` begins with `pathPrefix`. Used by the
 * shared-root stale detector — workspaces under the managed root that no
 * longer exist on disk are reaped from SQLite. The `LIKE ? || '%'` pattern
 * preserves the legacy index-friendly form.
 */
export function listWorkspaceRowsByPathPrefix({
	database,
	pathPrefix,
}: ListWorkspaceRowsByPathPrefixOptions): unknown[] {
	return database
		.prepare(
			"SELECT id, path, metadata_json AS metadataJson FROM workspaces WHERE path LIKE ? || '%'",
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
