import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { toast } from 'sonner';

import {
	archiveWorkspace,
	ensemblrQueryKeys,
	mergePullRequest,
	refreshPullRequestSnapshot,
} from '@/renderer/api/ensemblr-queries';
import {
	ReviewActionError,
	showReviewActionError,
} from '@/renderer/components/workbench-shell/review-actions/review-action-error';
import { deleteLastUsedOpenTarget } from '@/renderer/state/workspace/open-target-history';
import type { ReviewMergeSettings } from '@/renderer/types/settings';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

/**
 * Owns the merge-pull-request mutation plus the archive-after-merge follow-up.
 * (PR creation is handed to the chat agent — see `CreatePullRequestMenu`.)
 * Callers pass the active workspace and merge-settings snapshot, plus an
 * `onSettled` callback the provider uses to dismiss its active dialog.
 *
 * Invalidates the pull-request snapshot and workspace git-status queries after
 * every success so the review panel reflects the new state immediately.
 */
export function useReviewMutations({
	activeWorkspace,
	mergeSettings,
	onSettled,
}: {
	activeWorkspace: WorkspaceShellModel;
	mergeSettings: ReviewMergeSettings;
	onSettled: () => void;
}) {
	const queryClient = useQueryClient();
	const workspaceCwd = activeWorkspace.pathLabel;
	const workspaceId = activeWorkspace.id;

	const runArchiveAfterMerge = useCallback(async () => {
		try {
			const result = await archiveWorkspace({
				branchCleanup: mergeSettings.deleteLocalBranchOnArchive,
				reason: 'archive-after-merge',
				workspaceId,
			});
			if (result.status === 'success') {
				deleteLastUsedOpenTarget(workspaceId);
				toast.success('Pull request merged and workspace archived.');
			} else {
				toast.warning('Merge succeeded, but the workspace was not archived.', {
					description: result.diagnostics?.[0]?.message,
				});
			}
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.repositoryWorkspaceNavigation(),
			});
		} catch (cause) {
			toast.warning('Merge succeeded, but archiving the workspace failed.', {
				description: cause instanceof Error ? cause.message : undefined,
			});
		}
	}, [mergeSettings.deleteLocalBranchOnArchive, queryClient, workspaceId]);

	const mergeMutation = useMutation({
		mutationFn: async () => {
			const result = await mergePullRequest({ workspaceCwd, workspaceId });
			if (!result.merged) {
				throw new ReviewActionError(result.error);
			}
		},
		onError: (error) => showReviewActionError('Merge failed', error),
		onSuccess: () => {
			onSettled();
			void refreshPullRequestSnapshot({
				queryClient,
				workspaceCwd,
				workspaceId,
			}).catch((cause) => {
				// The merge already succeeded; a failed snapshot refresh only leaves
				// the panel stale until the next poll, so log rather than alarm.
				console.error('Failed to refresh PR snapshot after merge:', cause);
			});
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.workspaceGitStatus(workspaceCwd),
			});
			if (mergeSettings.archiveAfterMerge) {
				void runArchiveAfterMerge();
				return;
			}
			toast.success('Pull request merged.', {
				action: {
					label: 'Archive workspace',
					onClick: () => void runArchiveAfterMerge(),
				},
				description: 'Workspace can be archived now that the branch merged.',
			});
		},
	});

	return {
		mergeMutation,
	};
}
