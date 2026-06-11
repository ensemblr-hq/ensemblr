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
