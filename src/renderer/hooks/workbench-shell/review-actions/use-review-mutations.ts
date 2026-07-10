import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useCallback } from 'react';
import { toast } from 'sonner';

import {
	archiveWorkspace,
	ensemblrQueryKeys,
	invalidateWorkspaceListViews,
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
 * every success so the review panel reflects the new state immediately. When the
 * archive-after-merge follow-up succeeds it redirects to Welcome, since the just
 * archived workspace can no longer render a shell.
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
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const router = useRouter();
	const workspaceCwd = activeWorkspace.pathLabel;
	const workspaceId = activeWorkspace.id;

	/**
	 * Archives the merged workspace, then redirects to Welcome and refreshes the
	 * workspace list views on success. When the merge landed but the archive did
	 * not (skipped or thrown), it stays on the workspace and only refreshes the
	 * list views the merged branch state feeds.
	 */
	const runArchiveAfterMerge = useCallback(async () => {
		try {
			const result = await archiveWorkspace({
				branchCleanup: mergeSettings.deleteLocalBranchOnArchive,
				reason: 'archive-after-merge',
				workspaceId,
			});
			if (result.status === 'success') {
				deleteLastUsedOpenTarget(workspaceId);
				await navigate({ replace: true, to: '/' });
				await invalidateWorkspaceListViews(queryClient);
				await router.invalidate();
				toast.success('Pull request merged and workspace archived.');
				return;
			}
			toast.warning('Merge succeeded, but the workspace was not archived.', {
				description: result.diagnostics?.[0]?.message,
			});
		} catch (cause) {
			toast.warning('Merge succeeded, but archiving the workspace failed.', {
				description: cause instanceof Error ? cause.message : undefined,
			});
		}
		// The merge landed even when the archive didn't, so refresh the list
		// views the merged branch state feeds while the workspace stays put.
		await invalidateWorkspaceListViews(queryClient);
	}, [
		mergeSettings.deleteLocalBranchOnArchive,
		navigate,
		queryClient,
		router,
		workspaceId,
	]);

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
