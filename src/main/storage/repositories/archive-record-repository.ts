import type { DatabaseSync } from 'node:sqlite';

/**
 * Data-access functions for the `archive_records` table.
 *
 * Domain services (`src/main/repository/`) must call these helpers instead of
 * issuing raw `database.prepare(...)` calls so the SQL surface stays auditable
 * and column drift can be caught in one place.
 */

/** Kind of archive row being recorded. */
export type ArchiveRecordKind = 'repository' | 'workspace';

/** Inputs for {@link insertArchiveRecordRow}. */
export interface InsertArchiveRecordRowOptions {
	archivedAt: string;
	/** NULL for repository-kind records; nullable for workspace-kind records. */
	archivedContextPath: string | null;
	/** NULL for repository-kind records. */
	baseBranch: string | null;
	branchCleanup: boolean;
	/** NULL for repository-kind records. */
	branchName: string | null;
	database: DatabaseSync;
	kind: ArchiveRecordKind;
	reason: string | null;
	recordId: string;
	repositoryId: string;
	repositorySlug: string;
	/** Repository path for repository-kind records; workspace worktree for workspace-kind. */
	sourcePath: string;
	/** NULL for repository-kind records. */
	workspaceId: string | null;
	/** NULL for repository-kind records. */
	workspaceSlug: string | null;
}

/**
 * Inserts a row into `archive_records` using the canonical column list.
 *
 * Per-kind NULL coercion (repository-kind records get NULL workspace columns;
 * workspace-kind records use the worktree path as `source_path`) is the
 * caller's responsibility — see `insertArchiveRecord` in `archive-records.ts`
 * for the policy applied by the lifecycle services.
 */
export function insertArchiveRecordRow({
	archivedAt,
	archivedContextPath,
	baseBranch,
	branchCleanup,
	branchName,
	database,
	kind,
	reason,
	recordId,
	repositoryId,
	repositorySlug,
	sourcePath,
	workspaceId,
	workspaceSlug,
}: InsertArchiveRecordRowOptions): void {
	database
		.prepare(
			`INSERT INTO archive_records (
				id,
				record_type,
				repository_id,
				workspace_id,
				repository_slug,
				workspace_slug,
				branch_name,
				base_branch,
				source_path,
				archived_context_path,
				branch_cleanup,
				archive_reason,
				archived_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			recordId,
			kind,
			repositoryId,
			workspaceId,
			repositorySlug,
			workspaceSlug,
			branchName,
			baseBranch,
			sourcePath,
			archivedContextPath,
			branchCleanup ? 1 : 0,
			reason,
			archivedAt,
		);
}

/** Inputs for {@link updateArchiveRecordPruneState}. */
export interface UpdateArchiveRecordPruneStateOptions {
	database: DatabaseSync;
	/** Branch tip at prune time, so a branch deleted out of band stays recreatable. */
	prunedHeadCommit: string | null;
	/** Snapshot commit holding the working tree the prune removed. */
	prunedWipCommit: string | null;
	/** Private ref pinning the snapshot (and through it the branch) against `git gc`. */
	prunedWipRef: string | null;
	recordId: string;
}

/**
 * Stamps the prune columns onto an existing `archive_records` row. Pruning can
 * happen either during the archive itself or long afterwards from the archive
 * browser, so the state is written by UPDATE rather than folded into the INSERT.
 */
export function updateArchiveRecordPruneState({
	database,
	prunedHeadCommit,
	prunedWipCommit,
	prunedWipRef,
	recordId,
}: UpdateArchiveRecordPruneStateOptions): void {
	database
		.prepare(
			`UPDATE archive_records
			SET worktree_pruned = 1,
				pruned_head_commit = ?,
				pruned_wip_ref = ?,
				pruned_wip_commit = ?
			WHERE id = ?`,
		)
		.run(prunedHeadCommit, prunedWipRef, prunedWipCommit, recordId);
}

/**
 * Clears the prune columns on an archive row once its worktree exists again, so
 * a workspace that is unarchived and re-archived is not treated as pruned while
 * its files are back on disk.
 */
export function clearArchiveRecordPruneState({
	database,
	recordId,
}: {
	database: DatabaseSync;
	recordId: string;
}): void {
	database
		.prepare(
			`UPDATE archive_records
			SET worktree_pruned = 0,
				pruned_head_commit = NULL,
				pruned_wip_ref = NULL,
				pruned_wip_commit = NULL
			WHERE id = ?`,
		)
		.run(recordId);
}
