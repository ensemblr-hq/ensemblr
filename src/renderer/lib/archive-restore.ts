/** Minimal shape needed to decide whether an archived workspace can be restored. */
interface RestorableArchiveFields {
	baseBranch: string | null;
	branchCleanup: boolean;
	branchName: string | null;
	worktreePruned: boolean;
}

/**
 * Whether an archived workspace can be unarchived. A destroyed worktree
 * (`branchCleanup`) is rebuilt from the recorded base branch, so both it and
 * the branch name are required; a pruned one is re-derived by checking its own
 * branch out again, so only the branch name is. Shared by the History screen
 * ({@link HistoryRow}) and the per-repo archive browser
 * ({@link BrowseArchiveDialog}) so the gate lives in one place.
 */
export function canRestoreArchivedWorkspace(
	entry: RestorableArchiveFields,
): boolean {
	if (entry.branchCleanup) {
		return Boolean(entry.baseBranch && entry.branchName);
	}
	if (entry.worktreePruned) {
		return Boolean(entry.branchName);
	}
	return true;
}
