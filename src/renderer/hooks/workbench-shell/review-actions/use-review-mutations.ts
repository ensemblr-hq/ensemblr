import type { Mutation } from '@tanstack/react-query';
import {
	useMutation,
	useMutationState,
	useQueryClient,
} from '@tanstack/react-query';
import { useSetAtom } from 'jotai';
import { useCallback } from 'react';
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
import {
	continuedMergedPullRequestByWorkspaceAtom,
	useWorkspaceLifecycleRun,
	useWorkspaceLifecycleRunActions,
} from '@/renderer/state/workspace';
import type { ReviewMergeSettings } from '@/renderer/types/settings';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type { ContinueWorkspaceBranchResult } from '@/shared/ipc/contracts/workspace';

/**
 * The workspace a review run acts on. Passed as the mutation's variables rather
 * than read off the render that settles it: TanStack hands an in-flight mutation
 * the latest render's callbacks, so a workspace switch mid run would otherwise
 * point the follow-up refreshes at whichever workspace the shell had moved on
 * to.
 */
interface ReviewRunTarget {
	workspaceCwd: string;
	workspaceId: string;
}

/** The merged workspace a continue run targets, and the PR it moves past. */
interface ContinueMergedWorkspaceTarget extends ReviewRunTarget {
	pullRequestNumber: number | undefined;
}

/**
 * Tags a review run in the shared mutation cache so its busy state can be read
 * back per workspace instead of off this hook's own observer.
 *
 * The observer is the wrong source twice over: it is discarded when the shell
 * unmounts — which is what navigating to Welcome and back mid-run does — and
 * `MutationObserver.mutate` rebuilds it, so a second run started on another
 * workspace leaves the first reading idle while its git work is still going.
 * Either one re-enables the header's buttons over a live run, and a second click
 * forks the branch or pushes again. The cache outlives the shell and holds every
 * pending run rather than only the newest.
 */
const CONTINUE_MERGED_WORKSPACE_MUTATION_KEY = ['continue-merged-workspace'];

/** @see CONTINUE_MERGED_WORKSPACE_MUTATION_KEY */
const PUSH_BRANCH_MUTATION_KEY = ['push-workspace-branch'];

/**
 * Reads the workspace a cached review run targets.
 *
 * The cache is typed loosely because it holds every mutation in the app; the key
 * filter is what narrows this to one kind of run, and a pending one always
 * carries the variables `mutate` was called with.
 * @param mutation - A pending mutation matched by a review run's mutation key.
 * @returns The workspace id the run targets, or null when it carries none.
 */
function runTargetWorkspaceIdOf(mutation: Mutation): string | null {
	const target = mutation.state.variables as ReviewRunTarget | undefined;
	return target?.workspaceId ?? null;
}

/**
 * Whether a review run of one kind is still in flight against a workspace,
 * counting runs this hook instance never started.
 *
 * The filter is deliberately free of any workspace: `useMutationState` keeps its
 * options in a ref it refreshes in an effect, so a filter closing over the
 * rendered workspace would answer for whichever workspace was rendered when the
 * cache last changed. Reading every pending run and comparing in render has no
 * such window.
 * @param mutationKey - Identifies the kind of run, and must be a stable value.
 * @param workspaceId - The workspace to report on.
 * @returns Whether a run of that kind is pending against it.
 */
function useWorkspaceRunIsPending(
	mutationKey: string[],
	workspaceId: string,
): boolean {
	const targetedWorkspaceIds = useMutationState({
		filters: { mutationKey, status: 'pending' },
		select: runTargetWorkspaceIdOf,
	});
	return targetedWorkspaceIds.includes(workspaceId);
}

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
 *
 * Both merged-header runs carry their workspace in the mutation's variables and
 * report busy against that workspace rather than against `isPending` alone. The
 * hook outlives a workspace switch — the route component is reused across
 * workspace params, and the archive's own redirect lands the shell on a sibling
 * while the run is still settling — so a provider-wide pending flag showed the
 * next merged workspace's header as busy for the length of the list refetch.
 * Neither flag comes off this hook's observers, which do not survive the shell
 * unmounting: the archive reads `workspaceLifecycleRunsAtom` (the same record
 * the sidebar row and the Workspace menu read) and the continue reads the
 * mutation cache under {@link CONTINUE_MERGED_WORKSPACE_MUTATION_KEY}.
 *
 * Every action is published as a stable callback rather than as its mutation.
 * Handing the mutation out would put `isPending` — the provider-wide flag the
 * two booleans above exist to replace — back within reach of the next caller,
 * and would churn the provider's context value on every render, since
 * `useMutation` returns a fresh object each time.
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
	const { clearLifecycleRun, markLifecycleRun } =
		useWorkspaceLifecycleRunActions();

	/**
	 * Records a merged PR as locally dismissed so the merged header stops
	 * rendering for that workspace. No-ops when no PR number is known.
	 * @param target - The workspace the continue ran against, and the merged PR the user moved past.
	 */
	const dismissMergedPullRequest = (
		target: ContinueMergedWorkspaceTarget,
	): void => {
		const { pullRequestNumber, workspaceId: continuedWorkspaceId } = target;
		if (pullRequestNumber === undefined) {
			return;
		}
		setContinuedMergedPullRequests((current) => ({
			...current,
			[continuedWorkspaceId]: pullRequestNumber,
		}));
	};

	const archiveAfterMergeMutation = useMutation({
		mutationFn: (archivedWorkspaceId: string) =>
			archiveWorkspace({
				branchCleanup: mergeSettings.deleteLocalBranchOnArchive,
				reason: 'archive-after-merge',
				workspaceId: archivedWorkspaceId,
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
		onMutate: (archivedWorkspaceId: string) => {
			markLifecycleRun(archivedWorkspaceId, 'archiving');
		},
		onSettled: (_result, _cause, archivedWorkspaceId: string) => {
			clearLifecycleRun(archivedWorkspaceId);
		},
		onSuccess: async (result, archivedWorkspaceId) => {
			if (result.status === 'success') {
				setContinuedMergedPullRequests((current) => {
					if (!(archivedWorkspaceId in current)) {
						return current;
					}
					const { [archivedWorkspaceId]: _removed, ...rest } = current;
					return rest;
				});
				await removeWorkspace.archived(archivedWorkspaceId);
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
		mutationFn: (target: ContinueMergedWorkspaceTarget) =>
			continueWorkspaceBranch({ workspaceId: target.workspaceId }),
		mutationKey: CONTINUE_MERGED_WORKSPACE_MUTATION_KEY,
		onError: (cause) => {
			toast.error(
				t(
					'errors:continue-branch.failed.title',
					'Could not continue past the merged pull request.',
				),
				{ description: cause instanceof Error ? cause.message : undefined },
			);
		},
		onSuccess: async (result, target) => {
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
			dismissMergedPullRequest(target);
			announceContinueSuccess(result.branchName, result.diagnostics);
			await Promise.all([
				refreshPullRequestSnapshot({
					queryClient,
					workspaceCwd: target.workspaceCwd,
					workspaceId: target.workspaceId,
				}),
				invalidateWorkspaceGitStatus(queryClient, target.workspaceCwd),
				invalidateWorkspaceListViews(queryClient),
			]);
		},
	});

	const mergeMutation = useMutation({
		mutationFn: async (target: ReviewRunTarget) => {
			const result = await mergePullRequest({
				workspaceCwd: target.workspaceCwd,
				workspaceId: target.workspaceId,
			});
			if (!result.merged) {
				throw new ReviewActionError(result.error);
			}
		},
		onError: (error) =>
			showReviewActionError(
				t('errors:merge.failed.title', 'Merge failed'),
				error,
			),
		onSuccess: (_result, target) => {
			onSettled();
			void refreshPullRequestSnapshot({
				queryClient,
				workspaceCwd: target.workspaceCwd,
				workspaceId: target.workspaceId,
			}).catch((cause) => {
				console.error('Failed to refresh PR snapshot after merge:', cause);
			});
			void invalidateWorkspaceGitStatus(queryClient, target.workspaceCwd);
			if (mergeSettings.archiveAfterMerge) {
				archiveAfterMergeMutation.mutate(target.workspaceId);
			}
		},
	});

	const pushBranchMutation = useMutation({
		mutationFn: async (target: ReviewRunTarget) => {
			const result = await pushWorkspaceBranch({
				setUpstream: mergeSettings.setUpstreamOnPush,
				workspaceCwd: target.workspaceCwd,
			});
			if (!result.ok) {
				throw new ReviewActionError(result.error);
			}
		},
		mutationKey: PUSH_BRANCH_MUTATION_KEY,
		onError: (error) =>
			showReviewActionError(
				t('errors:push.failed.title', 'Push failed'),
				error,
			),
		onSuccess: async (_result, target) => {
			toast.success(t('errors:push.success.title', 'Branch pushed.'));
			await Promise.all([
				refreshPullRequestSnapshot({
					queryClient,
					workspaceCwd: target.workspaceCwd,
					workspaceId: target.workspaceId,
				}),
				invalidateWorkspaceGitStatus(queryClient, target.workspaceCwd),
			]);
		},
	});

	const { mutate: startArchive } = archiveAfterMergeMutation;
	const { mutate: startContinue } = continueMergedWorkspaceMutation;
	const { mutate: startMerge } = mergeMutation;
	const { mutate: startPush } = pushBranchMutation;

	/** Archives the workspace whose merged header is on screen. */
	const archiveMergedWorkspace = useCallback(() => {
		startArchive(workspaceId);
	}, [startArchive, workspaceId]);

	/** Branches the workspace on screen onto a successor of its merged branch. */
	const continueMergedWorkspace = useCallback(() => {
		startContinue({
			pullRequestNumber: activeWorkspace.pullRequest.number,
			workspaceCwd,
			workspaceId,
		});
	}, [
		activeWorkspace.pullRequest.number,
		startContinue,
		workspaceCwd,
		workspaceId,
	]);

	/** Merges the workspace's pull request, from the confirmation dialog only. */
	const merge = useCallback(() => {
		startMerge({ workspaceCwd, workspaceId });
	}, [startMerge, workspaceCwd, workspaceId]);

	/** Pushes the workspace's branch with git, skipping the agent. */
	const pushBranch = useCallback(() => {
		startPush({ workspaceCwd, workspaceId });
	}, [startPush, workspaceCwd, workspaceId]);

	const lifecycleRun = useWorkspaceLifecycleRun(workspaceId);
	const isContinuingMergedWorkspace = useWorkspaceRunIsPending(
		CONTINUE_MERGED_WORKSPACE_MUTATION_KEY,
		workspaceId,
	);
	const isPushingBranch = useWorkspaceRunIsPending(
		PUSH_BRANCH_MUTATION_KEY,
		workspaceId,
	);

	return {
		archiveMergedWorkspace,
		continueMergedWorkspace,
		isArchivingMergedWorkspace: lifecycleRun === 'archiving',
		isContinuingMergedWorkspace,
		isMerging: mergeMutation.isPending,
		isPushingBranch,
		merge,
		pushBranch,
	};
}
