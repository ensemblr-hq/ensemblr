import type { DatabaseSync } from 'node:sqlite';

/**
 * Kind of archive row being recorded. The column shapes below are derived
 * directly from this discriminator so callers do not need to know which
 * columns are nullable for each kind.
 */
export type ArchiveRecordKind = 'repository' | 'workspace';

/**
 * Input for {@link insertArchiveRecord}. Mirrors the `archive_records` table
 * exactly: every column is named, defaults are explicit, and `kind` selects
 * which columns are written vs. forced to NULL.
 */
export interface ArchiveRecordInput {
	archivedAt: string;
	/**
	 * Filesystem path the preserved `.context/` directory was copied to. NULL
	 * for repository-kind records and for workspace-kind records whose
	 * `.context/` could not be preserved.
	 */
	archivedContextPath: string | null;
	/** Recorded base branch of the workspace, NULL for repository-kind records. */
	baseBranch: string | null;
	branchCleanup: boolean;
	/** Branch checked out in the workspace worktree, NULL for repository-kind records. */
	branchName: string | null;
	database: DatabaseSync;
	kind: ArchiveRecordKind;
	reason: string | null;
	recordId: string;
	repositoryId: string;
	/** Repository path (used as source_path for repository-kind records). */
	repositoryPath: string;
	repositorySlug: string;
	/** Worktree path of the workspace, ignored for repository-kind records. */
	workspacePath: string | null;
	/** NULL for repository-kind records. */
	workspaceId: string | null;
	/** NULL for repository-kind records. */
	workspaceSlug: string | null;
}

/**
 * Shared INSERT into `archive_records`. Centralises the column list and the
 * per-kind NULL coercions so the workspace and repository archive services
 * cannot drift apart on row shape.
 */
export function insertArchiveRecord(input: ArchiveRecordInput): void {
	const {
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
		repositoryPath,
		repositorySlug,
		workspaceId,
		workspacePath,
		workspaceSlug,
	} = input;

	const isWorkspace = kind === 'workspace';
	const resolvedWorkspaceId = isWorkspace ? workspaceId : null;
	const resolvedWorkspaceSlug = isWorkspace ? workspaceSlug : null;
	const resolvedBranchName = isWorkspace ? branchName : null;
	const resolvedBaseBranch = isWorkspace ? baseBranch : null;
	const resolvedSourcePath = isWorkspace ? workspacePath : repositoryPath;
	const resolvedArchivedContextPath = isWorkspace ? archivedContextPath : null;

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
			resolvedWorkspaceId,
			repositorySlug,
			resolvedWorkspaceSlug,
			resolvedBranchName,
			resolvedBaseBranch,
			resolvedSourcePath,
			resolvedArchivedContextPath,
			branchCleanup ? 1 : 0,
			reason,
			archivedAt,
		);
}
