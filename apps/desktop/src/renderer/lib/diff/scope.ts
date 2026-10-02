import type { WorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';

/**
 * Whether a diff scope's new side is the on-disk working tree, which is what the
 * full-file view reconstructs from. Both the working-tree scope and a branch
 * diff qualify: git takes a branch diff (`merge-base…`) against the live
 * worktree, so the current file is its new side. A commit diff's new side is a
 * historical ref, not the worktree, so its full file cannot be read from disk.
 * @param scope - The diff scope, or undefined for the default working-tree diff
 * @returns True when the working-tree file is the diff's new side
 */
export function diffNewSideIsWorkingTree(
	scope: WorkspaceGitDiffScope | undefined,
): boolean {
	return !scope || scope.kind === 'working-tree' || scope.kind === 'branch';
}
