import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useCallback, useMemo, useState } from 'react';

import { reviewMergeSettingsQuery } from '@/renderer/api/ensemblr-queries';
import { useAgentActionRunner } from '@/renderer/hooks/workbench-shell/review-actions/use-agent-action-runner';
import { usePullRequestRefresh } from '@/renderer/hooks/workbench-shell/review-actions/use-pull-request-refresh';
import { useReviewMutations } from '@/renderer/hooks/workbench-shell/review-actions/use-review-mutations';
import type {
	ProjectShellModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import { MergeConfirmationDialog } from './merge-confirmation-dialog';
import {
	ReviewActionsContextProvider,
	type ReviewActionsValue,
} from './review-actions-context';

type ActiveReviewDialog = { kind: 'merge' } | null;

const DEFAULT_MERGE_SETTINGS = {
	archiveAfterMerge: false,
	deleteLocalBranchOnArchive: false,
	setUpstreamOnPush: true,
} as const;

/**
 * Wires the review-flow context and renders the merge confirmation dialog. All
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
		{
			workspaceCwd: activeWorkspace.pathLabel ?? null,
			workspaceId: activeWorkspace.id,
		},
	);
	const { mergeMutation } = useReviewMutations({
		activeWorkspace,
		mergeSettings,
		onSettled: closeDialog,
	});

	const value = useMemo<ReviewActionsValue>(
		() => ({
			isRefreshingPullRequest,
			openMergeConfirmation: () => setActiveDialog({ kind: 'merge' }),
			refreshPullRequest,
			runAgentAction,
		}),
		[isRefreshingPullRequest, refreshPullRequest, runAgentAction],
	);

	return (
		<ReviewActionsContextProvider value={value}>
			{children}
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
