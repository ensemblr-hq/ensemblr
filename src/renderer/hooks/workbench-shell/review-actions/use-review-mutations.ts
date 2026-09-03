import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
	archiveWorkspace,
	continueWorkspaceBranch,
	invalidateWorkspaceGitStatus,
	invalidateWorkspaceListViews,
	mergePullRequest,
	pushWorkspaceBranch,
	refreshPullRequestSnapshot,
} from '@/renderer/api/ensemblr-queries';
import { useRemoveWorkspaceAction } from '@/renderer/hooks/workbench-shell/use-remove-workspace-action';
import { failureText } from '@/renderer/lib/failure-text';
import { i18n } from '@/renderer/lib/i18n';
import { reclaimedDiskDescription } from '@/renderer/lib/workbench';
import {
	ReviewActionError,
	showReviewActionError,
} from '@/renderer/lib/workbench/review-action-error';
import { continuedMergedPullRequestByWorkspaceAtom } from '@/renderer/state/workspace';
import type { ReviewMergeSettings } from '@/renderer/types/settings';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type { ContinueWorkspaceBranchResult } from '@/shared/ipc/contracts/workspace';

/**
 * Announces a completed continue, downgrading to a warning toast when the
 * successor branch still carries commits the base has not taken.
 * @param branchName - The branch now checked out.
 * @param diagnostics - Warnings the service attached to the success.
 */
function announceContinueSuccess(
	branchName: string,
	diagnostics: ContinueWorkspaceBranchResult['diagnostics'],
): void {
	const [warning] = diagnostics;
	const title = i18n.t(
		'errors:continue-branch.success.title',
		'Continuing on {{branch}}.',
		{ branch: branchName },
	);
	if (warning) {
		toast.warning(title, {
			description: failureText(i18n.t, warning) ?? undefined,
		});
		return;
	}
	toast.success(title);
}

/**
 * Owns the merge-pull-request mutation, the archive mutation (which runs
 * automatically after a merge when archive-after-merge is enabled and otherwise
 * on demand from the merged-header Archive action), the continue mutation
 * behind the merged-header Continue action, and the direct branch push behind
 * the header's Push action — the one review chore that skips the agent, for
 * commits an agent made but never pushed.
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
	const queryClient = useQueryClient();
	const { t } = useTranslation();
	const setContinuedMergedPullRequests = useSetAtom(
		continuedMergedPullRequestByWorkspaceAtom,
	);
	const workspaceCwd = activeWorkspace.pathLabel;
	const workspaceId = activeWorkspace.id;
	const removeWorkspace = useRemoveWorkspaceAction({
		activeWorkspaceId: workspaceId,
	});

	/**
	 * Records a merged PR as locally dismissed so the merged header stops
	 * rendering for this workspace. No-ops when no PR number is known.
	 * @param pullRequestNumber - The merged PR the user moved past.
	 */
	const dismissMergedPullRequest = (
		pullRequestNumber: number | undefined,
	): void => {
		if (pullRequestNumber === undefined) {
			return;
		}
		setContinuedMergedPullRequests((current) => ({
			...current,
			[workspaceId]: pullRequestNumber,
		}));
	};

	const archiveAfterMergeMutation = useMutation({
		mutationFn: () =>
			archiveWorkspace({
				branchCleanup: mergeSettings.deleteLocalBranchOnArchive,
				reason: 'archive-after-merge',
				workspaceId,
			}),
		onError: async (cause) => {
			toast.warning(
				t(
					'errors:workspace-archive.failed.title',
					'Archiving the workspace failed.',
				),
				{ description: cause instanceof Error ? cause.message : undefined },
			);
			await invalidateWorkspaceListViews(queryClient);
		},
		onSuccess: async (result) => {
			if (result.status === 'success') {
				setContinuedMergedPullRequests((current) => {
					if (!(workspaceId in current)) {
						return current;
					}
					const { [workspaceId]: _removed, ...rest } = current;
					return rest;
				});
				await removeWorkspace.archived(workspaceId);
				toast.success(
					t('errors:workspace-archive.archived.title', 'Workspace archived.'),
					{
						description: reclaimedDiskDescription({
							bytesFreed: result.workspace?.bytesFreed ?? null,
							language: i18n.language,
							t,
						}),
					},
				);
				return;
			}
			toast.warning(
				t(
					'errors:workspace-archive.skipped.title',
					'The workspace was not archived.',
				),
				{ description: result.diagnostics?.[0]?.message },
			);
			await invalidateWorkspaceListViews(queryClient);
		},
	});

	const continueMergedWorkspaceMutation = useMutation({
		mutationFn: () => continueWorkspaceBranch({ workspaceId }),
		onError: (cause) => {
			toast.error(
				t(
					'errors:continue-branch.failed.title',
					'Could not continue past the merged pull request.',
				),
				{ description: cause instanceof Error ? cause.message : undefined },
			);
		},
		onSuccess: async (result) => {
			if (result.status !== 'success' || result.branchName === null) {
				toast.error(
					t(
						'errors:continue-branch.failed.title',
						'Could not continue past the merged pull request.',
					),
					{ description: result.diagnostics[0]?.message },
				);
				return;
			}
			// The snapshot refresh below is what actually retires the merged
			// header; dismissing locally first keeps it from flashing meanwhile.
			dismissMergedPullRequest(activeWorkspace.pullRequest.number);
			announceContinueSuccess(result.branchName, result.diagnostics);
			await Promise.all([
				refreshPullRequestSnapshot({
					queryClient,
					workspaceCwd,
					workspaceId,
				}),
				invalidateWorkspaceGitStatus(queryClient, workspaceCwd),
				invalidateWorkspaceListViews(queryClient),
			]);
		},
	});

	const mergeMutation = useMutation({
		mutationFn: async () => {
			const result = await mergePullRequest({ workspaceCwd, workspaceId });
			if (!result.merged) {
				throw new ReviewActionError(result.error);
			}
		},
		onError: (error) =>
			showReviewActionError(
				t('errors:merge.failed.title', 'Merge failed'),
				error,
			),
		onSuccess: () => {
			onSettled();
			void refreshPullRequestSnapshot({
				queryClient,
				workspaceCwd,
				workspaceId,
			}).catch((cause) => {
				console.error('Failed to refresh PR snapshot after merge:', cause);
			});
			void invalidateWorkspaceGitStatus(queryClient, workspaceCwd);
			if (mergeSettings.archiveAfterMerge) {
				archiveAfterMergeMutation.mutate();
			}
		},
	});

	const pushBranchMutation = useMutation({
		mutationFn: async () => {
			const result = await pushWorkspaceBranch({
				setUpstream: mergeSettings.setUpstreamOnPush,
				workspaceCwd,
			});
			if (!result.ok) {
				throw new ReviewActionError(result.error);
			}
		},
		onError: (error) =>
			showReviewActionError(
				t('errors:push.failed.title', 'Push failed'),
				error,
			),
		onSuccess: async () => {
			toast.success(t('errors:push.success.title', 'Branch pushed.'));
			await Promise.all([
				refreshPullRequestSnapshot({ queryClient, workspaceCwd, workspaceId }),
				invalidateWorkspaceGitStatus(queryClient, workspaceCwd),
			]);
		},
	});

	return {
		archiveAfterMergeMutation,
		continueMergedWorkspaceMutation,
		mergeMutation,
		pushBranchMutation,
	};
}
