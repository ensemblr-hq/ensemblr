import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useSetAtom } from 'jotai';
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
import { continuedMergedPullRequestByWorkspaceAtom } from '@/renderer/state/workspace';
import { deleteLastUsedOpenTarget } from '@/renderer/state/workspace/open-target-history';
import type { ReviewMergeSettings } from '@/renderer/types/settings';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

/**
 * Owns the merge-pull-request mutation plus the archive mutation, which runs
 * automatically after a merge when archive-after-merge is enabled and otherwise
 * on demand from the merged-header Archive action.
 * (PR creation is handed to the chat agent — see `CreatePullRequestMenu`.)
 * Callers pass the active workspace and merge-settings snapshot, plus an
 * `onSettled` callback the provider uses to dismiss its active dialog.
 *
 * Invalidates the pull-request snapshot and workspace git-status queries after
 * every success so the review panel reflects the new state immediately. When the
 * archive succeeds it redirects to Welcome, since the just archived workspace can
 * no longer render a shell.
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
	const setContinuedMergedPullRequests = useSetAtom(
		continuedMergedPullRequestByWorkspaceAtom,
	);
	const workspaceCwd = activeWorkspace.pathLabel;
	const workspaceId = activeWorkspace.id;

	const archiveAfterMergeMutation = useMutation({
		mutationFn: () =>
			archiveWorkspace({
				branchCleanup: mergeSettings.deleteLocalBranchOnArchive,
				reason: 'archive-after-merge',
				workspaceId,
			}),
		onError: async (cause) => {
			toast.warning('Archiving the workspace failed.', {
				description: cause instanceof Error ? cause.message : undefined,
			});
			await invalidateWorkspaceListViews(queryClient);
		},
		onSuccess: async (result) => {
			if (result.status === 'success') {
				deleteLastUsedOpenTarget(workspaceId);
				setContinuedMergedPullRequests((current) => {
					if (!(workspaceId in current)) {
						return current;
					}
					const { [workspaceId]: _removed, ...rest } = current;
					return rest;
				});
				await navigate({ replace: true, to: '/' });
				await invalidateWorkspaceListViews(queryClient);
				await router.invalidate();
				toast.success('Workspace archived.');
				return;
			}
			toast.warning('The workspace was not archived.', {
				description: result.diagnostics?.[0]?.message,
			});
			await invalidateWorkspaceListViews(queryClient);
		},
	});

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
				console.error('Failed to refresh PR snapshot after merge:', cause);
			});
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.workspaceGitStatus(workspaceCwd),
			});
			if (mergeSettings.archiveAfterMerge) {
				archiveAfterMergeMutation.mutate();
			}
		},
	});

	return {
		archiveAfterMergeMutation,
		mergeMutation,
	};
}
