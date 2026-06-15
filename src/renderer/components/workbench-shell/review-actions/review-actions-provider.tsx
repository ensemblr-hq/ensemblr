import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useCallback, useMemo, useState } from 'react';

import { reviewMergeSettingsQuery } from '@/renderer/api/ensemble-queries';
import type {
	ProjectShellModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

import { CommitPushDialog } from './commit-push-dialog';
import { CreatePullRequestDialog } from './create-pull-request-dialog';
import { MergeConfirmationDialog } from './merge-confirmation-dialog';
import {
	ReviewActionsContextProvider,
	type ReviewActionsValue,
} from './review-actions-context';
import { useAgentActionRunner } from './use-agent-action-runner';
import { usePullRequestRefresh } from './use-pull-request-refresh';
import { useReviewMutations } from './use-review-mutations';

type ActiveReviewDialog =
	| { draft: boolean; kind: 'create-pr' }
	| { kind: 'commit' }
	| { kind: 'merge' }
	| null;

const DEFAULT_MERGE_SETTINGS = {
	archiveAfterMerge: false,
	deleteLocalBranchOnArchive: false,
} as const;

/**
 * Wires the review-flow context and renders its three dialogs. All
 * data-fetching and mutation logic lives in dedicated hooks
 * (`useReviewMutations`, `usePullRequestRefresh`, `useAgentActionRunner`); the
 * provider only owns dialog visibility state and the context value.
 *
 * Merge never happens on the first click — the confirmation dialog is the only
 * path to `gh pr merge` (ADR 0023).
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
	const [activeDialog, setActiveDialog] = useState<ActiveReviewDialog>(null);
	const closeDialog = useCallback(() => setActiveDialog(null), []);

	const { data: mergeSettingsData } = useQuery(
		reviewMergeSettingsQuery({
			repositoryId: activeProject.id,
			repositoryPath: activeProject.pathLabel,
		}),
	);
	const mergeSettings = mergeSettingsData ?? DEFAULT_MERGE_SETTINGS;

	const runAgentAction = useAgentActionRunner({
		activeProject,
		activeWorkspace,
	});
	const { isRefreshingPullRequest, refreshPullRequest } = usePullRequestRefresh(
		{ workspaceId: activeWorkspace.id },
	);
	const { commitMutation, createPrMutation, mergeMutation } =
		useReviewMutations({
			activeWorkspace,
			mergeSettings,
			onSettled: closeDialog,
		});

	const value = useMemo<ReviewActionsValue>(
		() => ({
			isRefreshingPullRequest,
			openCommitAndPush: () => setActiveDialog({ kind: 'commit' }),
			openCreatePullRequest: (options) =>
				setActiveDialog({ draft: options?.draft ?? false, kind: 'create-pr' }),
			openMergeConfirmation: () => setActiveDialog({ kind: 'merge' }),
			refreshPullRequest,
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
						closeDialog();
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
						closeDialog();
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
						closeDialog();
					}
				}}
				open={activeDialog?.kind === 'merge'}
				workspace={activeWorkspace}
			/>
		</ReviewActionsContextProvider>
	);
}
