import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';

import { setWorkspaceBaseBranch } from '@/renderer/api/ensemblr';
import { invalidateWorkspaceListViews } from '@/renderer/api/ensemblr/invalidate-workspace-list-views';
import { originQualifiedRef } from '@/renderer/lib/workbench/branch-ref';

/** Shown when the bridge rejects, where no service diagnostic exists to quote. */
const RETARGET_FAILED_MESSAGE = 'Could not change the target branch.';

/** Retarget callbacks for one workspace, plus whether a write is in flight. */
export interface WorkspaceTargetBranchControls {
	isPending: boolean;
	/** Retargets to a bare branch name, qualifying it with the default remote. */
	retargetBranch: (branchName: string) => void;
	/** Retargets to a ref given verbatim, for remotes and tags GitHub does not list. */
	retargetRef: (ref: string) => void;
}

/**
 * Retargets which branch a workspace reviews and opens pull requests against.
 * The review panel reads its diff scope off the navigation snapshot, so
 * refreshing that is what re-scopes the diff, conflicts, and commit list.
 * @param workspaceId - Workspace to retarget.
 * @returns The retarget callbacks and the in-flight flag.
 */
export function useWorkspaceTargetBranch(
	workspaceId: string,
): WorkspaceTargetBranchControls {
	const queryClient = useQueryClient();

	const { isPending, mutate } = useMutation({
		mutationFn: (baseBranch: string) =>
			setWorkspaceBaseBranch({ baseBranch, workspaceId }),
		onError: () => {
			toast.error(RETARGET_FAILED_MESSAGE);
		},
		onSuccess: async (result) => {
			if (result.status === 'failure') {
				toast.error(result.diagnostics[0]?.message ?? RETARGET_FAILED_MESSAGE);
				return;
			}
			await invalidateWorkspaceListViews(queryClient);
		},
	});

	const retargetRef = useCallback(
		(ref: string): void => {
			const baseBranch = ref.trim();
			if (baseBranch) {
				mutate(baseBranch);
			}
		},
		[mutate],
	);

	const retargetBranch = useCallback(
		(branchName: string): void => {
			retargetRef(originQualifiedRef(branchName) ?? '');
		},
		[retargetRef],
	);

	return { isPending, retargetBranch, retargetRef };
}
