import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';

import {
	archiveWorkspace,
	commitWorkspaceChanges,
	createPullRequest,
	ensembleQueryKeys,
	mergePullRequest,
	pushWorkspaceBranch,
} from '@/renderer/api/ensemble-queries';
import {
	ReviewActionError,
	showReviewActionError,
} from '@/renderer/components/workbench-shell/review-actions/review-action-error';
import { deleteLastUsedOpenTarget } from '@/renderer/state/workspace/open-target-history';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

/** Effective merge-settings snapshot — see `reviewMergeSettingsQuery`. */
export interface ReviewMergeSettings {
	archiveAfterMerge: boolean;
	deleteLocalBranchOnArchive: boolean;
}

/**
 * Owns the three review-flow mutations (commit & push, create pull request,
 * merge pull request) plus the archive-after-merge follow-up. Callers pass the
 * active workspace and merge-settings snapshot, plus an `onSettled` callback
 * the provider uses to dismiss its active dialog.
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

	const invalidateReviewState = useCallback(() => {
		void queryClient.invalidateQueries({
			queryKey: ensembleQueryKeys.pullRequestSnapshot(workspaceId),
		});
		void queryClient.invalidateQueries({
			queryKey: ensembleQueryKeys.workspaceGitStatus(workspaceCwd),
		});
	}, [queryClient, workspaceCwd, workspaceId]);

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
				queryKey: ensembleQueryKeys.repositoryWorkspaceNavigation(),
			});
		} catch (cause) {
			toast.warning('Merge succeeded, but archiving the workspace failed.', {
				description: cause instanceof Error ? cause.message : undefined,
			});
		}
	}, [mergeSettings.deleteLocalBranchOnArchive, queryClient, workspaceId]);

	const commitMutation = useMutation({
		mutationFn: async (message: string) => {
			const commitResult = await commitWorkspaceChanges({
				message,
				workspaceCwd,
			});
			if (!commitResult.ok) {
				throw new ReviewActionError(commitResult.error);
			}
			const pushResult = await pushWorkspaceBranch({ workspaceCwd });
			if (!pushResult.ok) {
				throw new ReviewActionError(pushResult.error);
			}
		},
		onError: (error) => showReviewActionError('Commit and push failed', error),
		onSuccess: () => {
			toast.success('Changes committed and pushed.');
			onSettled();
			invalidateReviewState();
		},
	});

	const createPrMutation = useMutation({
		mutationFn: async ({
			body,
			commitFirst,
			draft,
			title,
		}: {
			body: string;
			commitFirst: boolean;
			draft: boolean;
			title: string;
		}) => {
			if (commitFirst) {
				const commitResult = await commitWorkspaceChanges({
					message: title,
					workspaceCwd,
				});
				if (
					!commitResult.ok &&
					commitResult.error?.code !== 'nothing-to-commit'
				) {
					throw new ReviewActionError(commitResult.error);
				}
			}
			const pushResult = await pushWorkspaceBranch({ workspaceCwd });
			if (!pushResult.ok) {
				throw new ReviewActionError(pushResult.error);
			}
			const baseBranch =
				activeWorkspace.landingSummary?.branchSource.baseBranch;
			const createResult = await createPullRequest({
				...(baseBranch ? { baseBranch } : {}),
				body,
				draft,
				title,
				workspaceCwd,
			});
			if (!createResult.ok) {
				throw new ReviewActionError(createResult.error);
			}
			return createResult;
		},
		onError: (error) =>
			showReviewActionError('Pull request creation failed', error),
		onSuccess: (result) => {
			toast.success(
				result.pullRequestNumber
					? `Pull request #${result.pullRequestNumber} created.`
					: 'Pull request created.',
			);
			onSettled();
			invalidateReviewState();
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
			invalidateReviewState();
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
		commitMutation,
		createPrMutation,
		mergeMutation,
	};
}
