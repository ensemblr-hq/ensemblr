import type { ReviewMergeSettings } from '@/renderer/types/settings';

/** What an archive asks the main process to do to the workspace's worktree. */
export interface ArchiveWorktreePlan {
	branchCleanup: boolean;
}

/** A completed archive, reduced to what its announcement needs to word itself. */
export interface ArchivedWorkspace {
	/**
	 * Whether the archive dropped the local branch. That variant force-deletes it
	 * and cuts a fresh branch from base on unarchive, so nothing may offer to take
	 * it back.
	 */
	branchCleanup: boolean;
	/** Disk the worktree removal freed, or null when it could not be measured. */
	bytesFreed: number | null;
	workspaceId: string;
}

/**
 * Resolves what the repository's git settings make this archive do to the
 * branch. The worktree folder always goes; the only question is whether the
 * branch goes with it. Settings that have not resolved — still pending, or a
 * read that failed — keep the branch, the outcome that loses nothing.
 *
 * The instant archive and the confirmation dialog both read this, so the two
 * outcomes stay one rule: the dialog's wording cannot describe an archive
 * different from the one that runs.
 * @param options - Whether the workspace has a branch, and the resolved git settings
 * @returns The worktree plan the archive IPC takes
 */
export function resolveArchiveWorktreePlan({
	hasBranch,
	settings,
}: {
	hasBranch: boolean;
	settings: ReviewMergeSettings | undefined;
}): ArchiveWorktreePlan {
	return {
		branchCleanup: hasBranch && settings?.deleteLocalBranchOnArchive === true,
	};
}
