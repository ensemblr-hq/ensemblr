import {
	hashKey,
	type QueryClient,
	useQueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';

import {
	ensemblrQueryKeys,
	syncUncommittedFilesToBranchStatus,
} from '@/renderer/api/ensemblr-queries';
import type { GetWorkspaceGitStatusResult } from '@/shared/ipc/contracts/workspace-git';

/**
 * Carries a cached working-tree read's file count into the branch-scoped statuses
 * of the same workspace, when the read holds usable data.
 * @param queryClient - The query client holding the cached statuses
 * @param workspaceCwd - Absolute workspace root the read belongs to
 */
function carryCachedWorkingTreeCount(
	queryClient: QueryClient,
	workspaceCwd: string,
): void {
	const state = queryClient.getQueryState<GetWorkspaceGitStatusResult>(
		ensemblrQueryKeys.workspaceGitStatus(workspaceCwd),
	);
	if (!state?.data || state.data.error) {
		return;
	}
	syncUncommittedFilesToBranchStatus(queryClient, {
		observedAt: state.dataUpdatedAt,
		uncommittedFiles: state.data.summary.files,
		workspaceCwd,
	});
}

/**
 * Keeps the branch-scoped statuses' working-tree count in step with the open
 * workspace's own working-tree read, on mount and after every successful read.
 *
 * It listens to the query cache instead of reading `dataUpdatedAt` off the query
 * in a component: that timestamp moves on every poll, so reading it re-rendered
 * the whole route every ten seconds even when the status had not changed, yet an
 * identical read still has to carry, because it advances the moment the branch
 * entries are compared against.
 * @param workspaceCwd - Absolute workspace root, or null while none is known
 */
export function useCarryWorkingTreeCount(workspaceCwd: string | null): void {
	const queryClient = useQueryClient();

	useEffect(() => {
		if (!workspaceCwd) {
			return undefined;
		}
		const workingTreeHash = hashKey(
			ensemblrQueryKeys.workspaceGitStatus(workspaceCwd),
		);
		carryCachedWorkingTreeCount(queryClient, workspaceCwd);
		return queryClient.getQueryCache().subscribe((event) => {
			if (
				event.type === 'updated' &&
				event.action.type === 'success' &&
				event.query.queryHash === workingTreeHash
			) {
				carryCachedWorkingTreeCount(queryClient, workspaceCwd);
			}
		});
	}, [queryClient, workspaceCwd]);
}
