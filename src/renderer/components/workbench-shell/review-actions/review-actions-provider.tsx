import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
	agentActionTemplatesQuery,
	archiveWorkspace,
	commitWorkspaceChanges,
	createPullRequest,
	ensembleQueryKeys,
	mergePullRequest,
	pushWorkspaceBranch,
	reviewMergeSettingsQuery,
} from '@/renderer/api/ensemble-queries';
import {
	AGENT_ACTION_SETTING_KEYS,
	type AgentActionKind,
	buildAgentActionPrompt,
	resolveAgentActionTemplate,
} from '@/renderer/lib/workbench/agent-actions';
import { useComposerInsert } from '@/renderer/state/composer-insert';
import type {
	ProjectShellModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { GithubFailure } from '@/shared/ipc';

import { CommitPushDialog } from './commit-push-dialog';
import { CreatePullRequestDialog } from './create-pull-request-dialog';
import { MergeConfirmationDialog } from './merge-confirmation-dialog';
import {
	ReviewActionsContextProvider,
	type ReviewActionsValue,
} from './review-actions-context';

type ActiveReviewDialog =
	| { draft: boolean; kind: 'create-pr' }
	| { kind: 'commit' }
	| { kind: 'merge' }
	| null;

/**
 * Owns the review-flow dialogs (commit & push, create PR, merge confirmation)
 * and the gh snapshot refresh action. Merge never happens on the first click —
 * the confirmation dialog is the only path to `gh pr merge` (ADR 0023).
 */
export function ReviewActionsProvider({
	activeProject,
	activeWorkspace,
	children,
}: {
	activeProject: ProjectShellModel;
	activeWorkspace: WorkspaceShellModel;
	children: ReactNode;
}) {
	const queryClient = useQueryClient();
	const [activeDialog, setActiveDialog] = useState<ActiveReviewDialog>(null);
	const workspaceCwd = activeWorkspace.pathLabel;
	const workspaceId = activeWorkspace.id;
	const mergeSettingsQueryState = useQuery(
		reviewMergeSettingsQuery({
			repositoryId: activeProject.id,
			repositoryPath: activeProject.pathLabel,
		}),
	);
	const mergeSettings = mergeSettingsQueryState.data ?? {
		archiveAfterMerge: false,
		deleteLocalBranchOnArchive: false,
	};
	const insertIntoComposer = useComposerInsert();
	const actionTemplatesQueryState = useQuery(
		agentActionTemplatesQuery({
			repositoryId: activeProject.id,
			repositoryPath: activeProject.pathLabel,
		}),
	);
	const actionTemplates = actionTemplatesQueryState.data;

	const runAgentAction = useCallback(
		(action: AgentActionKind) => {
			const setting = actionTemplates?.[AGENT_ACTION_SETTING_KEYS[action]];
			const resolved = resolveAgentActionTemplate({
				action,
				settingSource: setting?.source,
				settingValue: setting?.value,
			});
			insertIntoComposer(
				buildAgentActionPrompt({
					action,
					template: resolved.template,
					workspace: activeWorkspace,
				}),
			);
			toast.success('Prompt added to chat for review.', {
				description: `Template source: ${resolved.source}. Edit before sending if needed.`,
			});
		},
		[actionTemplates, activeWorkspace, insertIntoComposer],
	);

	const invalidateReviewState = useCallback(() => {
		void queryClient.invalidateQueries({
			queryKey: ensembleQueryKeys.pullRequestSnapshot(workspaceId),
		});
		void queryClient.invalidateQueries({
			queryKey: ensembleQueryKeys.workspaceGitStatus(workspaceCwd),
		});
	}, [queryClient, workspaceCwd, workspaceId]);

	const [isRefreshingPullRequest, setIsRefreshingPullRequest] = useState(false);
	const refreshPullRequest = useCallback(async () => {
		setIsRefreshingPullRequest(true);
		try {
			await queryClient.refetchQueries({
				queryKey: ensembleQueryKeys.pullRequestSnapshot(workspaceId),
			});
		} catch (cause) {
			toast.error('Pull request refresh failed', {
				description: cause instanceof Error ? cause.message : undefined,
			});
		} finally {
			setIsRefreshingPullRequest(false);
		}
	}, [queryClient, workspaceId]);

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
			setActiveDialog(null);
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
			setActiveDialog(null);
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
			setActiveDialog(null);
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

	/**
	 * Applies the archive-after-merge policy. Cleanup failures surface their own
	 * toast and never mask the successful merge (ENS-060).
	 */
	const runArchiveAfterMerge = useCallback(async () => {
		try {
			const result = await archiveWorkspace({
				branchCleanup: mergeSettings.deleteLocalBranchOnArchive,
				reason: 'archive-after-merge',
				workspaceId,
			});
			if (result.status === 'success') {
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

	const value = useMemo<ReviewActionsValue>(
		() => ({
			isRefreshingPullRequest,
			openCommitAndPush: () => setActiveDialog({ kind: 'commit' }),
			openCreatePullRequest: (options) =>
				setActiveDialog({ draft: options?.draft ?? false, kind: 'create-pr' }),
			openMergeConfirmation: () => setActiveDialog({ kind: 'merge' }),
			refreshPullRequest: () => void refreshPullRequest(),
			runAgentAction,
		}),
		[isRefreshingPullRequest, refreshPullRequest, runAgentAction],
	);

	return (
		<ReviewActionsContextProvider value={value}>
			{children}
			<CommitPushDialog
				isSubmitting={commitMutation.isPending}
				onOpenChange={(open) => {
					if (!open) {
						setActiveDialog(null);
					}
				}}
				onSubmit={(message) => commitMutation.mutate(message)}
				open={activeDialog?.kind === 'commit'}
				workspace={activeWorkspace}
			/>
			<CreatePullRequestDialog
				initialDraft={activeDialog?.kind === 'create-pr' && activeDialog.draft}
				isSubmitting={createPrMutation.isPending}
				onOpenChange={(open) => {
					if (!open) {
						setActiveDialog(null);
					}
				}}
				onSubmit={(input) =>
					createPrMutation.mutate({
						...input,
						commitFirst: activeWorkspace.changeSummary.files > 0,
					})
				}
				open={activeDialog?.kind === 'create-pr'}
				workspace={activeWorkspace}
			/>
			<MergeConfirmationDialog
				archiveAfterMerge={mergeSettings.archiveAfterMerge}
				deleteLocalBranchOnArchive={mergeSettings.deleteLocalBranchOnArchive}
				isSubmitting={mergeMutation.isPending}
				onConfirm={() => mergeMutation.mutate()}
				onOpenChange={(open) => {
					if (!open) {
						setActiveDialog(null);
					}
				}}
				open={activeDialog?.kind === 'merge'}
				workspace={activeWorkspace}
			/>
		</ReviewActionsContextProvider>
	);
}

/** Error wrapper preserving the typed gh failure for toast remediation. */
class ReviewActionError extends Error {
	readonly failure?: GithubFailure;

	constructor(failure?: GithubFailure) {
		super(failure?.message ?? 'GitHub action failed.');
		this.failure = failure;
	}
}

function showReviewActionError(title: string, error: unknown): void {
	const failure =
		error instanceof ReviewActionError ? error.failure : undefined;
	toast.error(title, {
		description: failure
			? [failure.message, failure.remediation].filter(Boolean).join(' — ')
			: error instanceof Error
				? error.message
				: undefined,
	});
}
