/** Minimal shape needed to decide whether an archived workspace can be restored. */
interface RestorableArchiveFields {
	baseBranch: string | null;
	branchCleanup: boolean;
	branchName: string | null;
}

/**
 * Whether an archived workspace can be unarchived. When the original archive
 * destroyed the worktree + branch (`branchCleanup`), the recorded base branch
 * and branch name are both required to recreate it; missing either blocks the
 * restore. Shared by the History screen ({@link HistoryRow}) and the per-repo
 * archive browser ({@link BrowseArchiveDialog}) so the gate lives in one place.
 */
export function canRestoreArchivedWorkspace(
	entry: RestorableArchiveFields,
): boolean {
	if (!entry.branchCleanup) {
		return true;
	}
	return Boolean(entry.baseBranch && entry.branchName);
}
