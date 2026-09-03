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

/** Inputs for {@link selectWorkspaceBaseBranchById}. */
export interface SelectWorkspaceBaseBranchByIdOptions {
	database: DatabaseSync;
	workspaceId: string;
}

/**
 * Returns the merge target a workspace was opened against, or `null` when the
 * row does not exist or carries no base. Stored either bare (`staging`) or
 * remote-qualified (`origin/staging`), so callers normalize before comparing.
 */
export function selectWorkspaceBaseBranchById({
	database,
	workspaceId,
}: SelectWorkspaceBaseBranchByIdOptions): string | null {
	const row = database
		.prepare(`SELECT base_branch AS baseBranch FROM workspaces WHERE id = ?`)
		.get(workspaceId) as { baseBranch: string | null } | undefined;
	return row?.baseBranch ?? null;
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

/** Inputs for {@link updateWorkspaceBranchRow}. */
export interface UpdateWorkspaceBranchRowOptions {
	branchName: string;
	database: DatabaseSync;
	id: string;
	metadataJson: string;
	timestamp: string;
}

/**
 * Points a workspace at a different branch, carrying the metadata that records
 * which branches it has continued off, without touching its name — used when
 * the workspace continues onto a successor branch after its pull request
 * merged.
 */
export function updateWorkspaceBranchRow({
	branchName,
	database,
	id,
	metadataJson,
	timestamp,
}: UpdateWorkspaceBranchRowOptions): void {
	database
		.prepare(
			`UPDATE workspaces
				SET branch_name = ?,
					metadata_json = ?,
					updated_at = ?
				WHERE id = ?`,
		)
		.run(branchName, metadataJson, timestamp, id);
}

/** Inputs for {@link updateWorkspaceBaseBranchRow}. */
export interface UpdateWorkspaceBaseBranchRowOptions {
	baseBranch: string;
	database: DatabaseSync;
	id: string;
	timestamp: string;
}

/**
 * Retargets the base a workspace reviews and opens pull requests against,
 * leaving its own branch and worktree untouched — the fork already happened, so
 * only the merge-base for diffs, conflicts, and the PR target moves.
 */
export function updateWorkspaceBaseBranchRow({
	baseBranch,
	database,
	id,
	timestamp,
}: UpdateWorkspaceBaseBranchRowOptions): void {
	database
		.prepare(
			`UPDATE workspaces
				SET base_branch = ?,
					updated_at = ?
				WHERE id = ?`,
		)
		.run(baseBranch, timestamp, id);
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

/** Inputs for {@link listActiveWorkspaceSnapshotRowsByRepository}. */
export interface ListActiveWorkspaceSnapshotRowsByRepositoryOptions {
	database: DatabaseSync;
	repositoryId: string;
}

/**
 * Every column a `CreatedWorkspaceSnapshot` is built from, for one non-archived
 * workspace. `metadataJson` is still encoded; callers parse it with
 * `parseMetadata`.
 */
export interface ActiveWorkspaceSnapshotRow {
	baseBranch: string | null;
	branchName: string | null;
	createdAt: string;
	id: string;
	metadataJson: string;
	name: string;
	path: string;
	slug: string;
	updatedAt: string;
}

/**
 * Returns the full snapshot columns for every non-archived workspace in a
 * repository. Create-workspace reads this to answer "which workspace already
 * holds the worktree git says has this branch checked out", which it settles by
 * comparing real paths rather than in SQL — git reports worktree paths with
 * symlinks resolved while the `path` column stores them as the user gave them.
 * @param options - The open database connection and the repository to scope to.
 * @returns One row per active workspace in the repository.
 */
export function listActiveWorkspaceSnapshotRowsByRepository({
	database,
	repositoryId,
}: ListActiveWorkspaceSnapshotRowsByRepositoryOptions): ActiveWorkspaceSnapshotRow[] {
	return database
		.prepare(
			`SELECT
				id AS id,
				slug AS slug,
				name AS name,
				path AS path,
				branch_name AS branchName,
				base_branch AS baseBranch,
				created_at AS createdAt,
				updated_at AS updatedAt,
				metadata_json AS metadataJson
			FROM workspaces
			WHERE repository_id = ? AND archived_at IS NULL`,
		)
		.all(repositoryId) as unknown as ActiveWorkspaceSnapshotRow[];
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

/**
 * `id` + worktree `path` for one non-archived workspace, plus the two slices of
 * its cached GitHub snapshot that decide how often it needs refreshing. Both
 * snapshot columns are null when the workspace has no cache row or the row does
 * not hold parseable JSON.
 */
export interface ActiveWorkspacePrCheckRow {
	/** The cached pull request's `checks` array, still JSON-encoded. */
	checksJson: string | null;
	id: string;
	path: string;
	/** The cached pull request's state (`open`, `merged`, `closed`). */
	pullRequestState: string | null;
}

/**
 * Returns every non-archived workspace alongside the cached pull request's state
 * and checks, joined from `integration_metadata` in one statement. The PR-status
 * sweeper reads this each tick to decide which workspaces are refreshing on the
 * short cadence, so it narrows the snapshot in SQL rather than inflating each
 * cached row's comments, body, and deployments to answer one question about
 * checks. `json_valid` guards the extraction because the cache tolerates a
 * malformed row rather than failing the whole listing.
 * @param options - The open database connection.
 * @returns One row per active workspace.
 */
export function listActiveWorkspacePrCheckRows({
	database,
}: {
	database: DatabaseSync;
}): ActiveWorkspacePrCheckRow[] {
	return database
		.prepare(
			`SELECT
				w.id AS id,
				w.path AS path,
				CASE WHEN json_valid(im.metadata_json)
					THEN json_extract(im.metadata_json, '$.pullRequest.state')
				END AS pullRequestState,
				CASE WHEN json_valid(im.metadata_json)
					THEN json_extract(im.metadata_json, '$.pullRequest.checks')
				END AS checksJson
			FROM workspaces w
			LEFT JOIN integration_metadata im
				ON im.provider = 'github'
				AND im.resource_type = 'pull-request'
				AND im.resource_id = w.id
				AND im.external_id = ''
			WHERE w.archived_at IS NULL`,
		)
		.all() as unknown as ActiveWorkspacePrCheckRow[];
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
 * `base_branch` and `archived_context_path`, and the prune columns carry what a
 * pruned workspace needs to be re-derived from git.
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
				a.branch_cleanup AS branchCleanupRaw,
				a.worktree_pruned AS worktreePrunedRaw,
				a.pruned_head_commit AS prunedHeadCommit,
				a.pruned_wip_ref AS prunedWipRef,
				a.pruned_wip_commit AS prunedWipCommit
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
 * shape minimal for that consumer. The prune columns are included so a
 * permanent delete can drop the private ref pinning the pruned snapshot.
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
				a.branch_cleanup AS branchCleanupRaw,
				a.worktree_pruned AS worktreePrunedRaw,
				a.pruned_head_commit AS prunedHeadCommit,
				a.pruned_wip_ref AS prunedWipRef,
				a.pruned_wip_commit AS prunedWipCommit
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
 * Carries the prune columns so the archive browser can say how each archive
 * disposed of its worktree, and so a rehydrate knows what to restore from.
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
				a.branch_cleanup AS branchCleanupRaw,
				a.worktree_pruned AS worktreePrunedRaw,
				a.pruned_head_commit AS prunedHeadCommit,
				a.pruned_wip_ref AS prunedWipRef,
				a.pruned_wip_commit AS prunedWipCommit
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
 * matching `archive_records` row (for base branch, branch-cleanup, and prune
 * state, used to gate the Unarchive action). Ordered by last activity (with `id` as a
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
				a.branch_cleanup AS branchCleanupRaw,
				a.worktree_pruned AS worktreePrunedRaw
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
 * Returns live workspace rows whose `path` begins with `pathPrefix`. Used by the
 * shared-root stale detector — workspaces under the managed root that no longer
 * exist on disk are reaped from SQLite. Archived rows are excluded because
 * archiving with branch cleanup deliberately removes the worktree while keeping
 * the row, so reaping them turned every such archive into an unrecoverable
 * delete on the next launch. The `LIKE ? || '%'` pattern preserves the legacy
 * index-friendly form.
 */
export function listWorkspaceRowsByPathPrefix({
	database,
	pathPrefix,
}: ListWorkspaceRowsByPathPrefixOptions): unknown[] {
	return database
		.prepare(
			"SELECT id, path, metadata_json AS metadataJson FROM workspaces WHERE path LIKE ? || '%' AND archived_at IS NULL",
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
