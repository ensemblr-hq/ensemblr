import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { workspaceGitStatusQuery } from '@/renderer/api/ensemblr';
import { hasReviewableChanges } from '@/renderer/lib/workbench/review-presence';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type { WorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';

/**
 * Whether the workspace has any diff worth acting on — committed-on-branch OR
 * uncommitted — by reading the whole branch diff vs base. Falls back to the
 * working-tree file count while that read is loading or errored, so an action
 * shows immediately on a dirty worktree instead of waiting on the branch read.
 *
 * Shared by the Review affordance, the header's Create PR action, and the
 * Checks panel; they all issue the same branch-scoped query key, so React Query
 * dedupes it to a single git read per workspace. No known base degrades to the
 * working-tree scope.
 */
export function useReviewableChanges(workspace: WorkspaceShellModel): boolean {
	const baseRef = workspace.landingSummary?.branchSource.baseBranch ?? null;
	const branchScope = useMemo<WorkspaceGitDiffScope>(
		() => (baseRef ? { baseRef, kind: 'branch' } : { kind: 'working-tree' }),
		[baseRef],
	);
	const { data: branchStatus } = useQuery({
		...workspaceGitStatusQuery(workspace.pathLabel ?? null, branchScope),
		placeholderData: keepPreviousData,
	});
	return hasReviewableChanges(branchStatus, workspace.changeSummary.files);
}
