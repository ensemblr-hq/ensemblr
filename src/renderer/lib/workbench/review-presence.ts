import type { GetWorkspaceGitStatusResult } from '@/shared/ipc/contracts/workspace-git';

/**
 * Whether the workspace has any diff worth reviewing — committed-on-branch OR
 * uncommitted. Prefers the branch-scoped status (the full diff vs base); while
 * that is still loading or errored, falls back to the working-tree file count so
 * the Review affordance shows immediately when the worktree is dirty instead of
 * waiting on the branch read. (A clean worktree with commits ahead of base still
 * waits for the branch status to resolve before the affordance appears.)
 */
export function hasReviewableChanges(
	branchStatus: GetWorkspaceGitStatusResult | undefined,
	workingTreeFileCount: number,
): boolean {
	if (branchStatus && !branchStatus.error) {
		return branchStatus.summary.files > 0;
	}
	return workingTreeFileCount > 0;
}
