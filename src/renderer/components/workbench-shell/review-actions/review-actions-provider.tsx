import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { reviewMergeSettingsQuery } from '@/renderer/api/ensemblr-queries';
import { usePullRequestRefresh } from '@/renderer/hooks/workbench-shell/review-actions/use-pull-request-refresh';
import { useReviewMutations } from '@/renderer/hooks/workbench-shell/review-actions/use-review-mutations';
import { useWorkspaceBusy } from '@/renderer/hooks/workspace/use-workspace-busy';
import { buildCommitAndPushPrompt } from '@/renderer/lib/workbench/checks-pr-prompts';
import { useComposerSubmit } from '@/renderer/state/composer';
import type {
	AgentActionKind,
	ProjectShellModel,
	ReviewActionsValue,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import { MergeConfirmationDialog } from './merge-confirmation-dialog';
import { ReviewActionsContextProvider } from './review-actions-context';

/** Which review dialog is currently open, or null when none is. */
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
 *
 * Agent activity is read once here and published as `isAgentWorking`: every
 * review surface — both header variants and the Checks panel — sits under this
 * provider, so one busy subscription freezes them all in step.
 */
export function ReviewActionsProvider({
	activeProject,
	activeWorkspace,
	children,
	runAgentAction,
}: {
	activeProject: ProjectShellModel;
	activeWorkspace: WorkspaceShellModel;
	children: ReactNode;
	runAgentAction: (action: AgentActionKind) => void;
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

	const { isRefreshingPullRequest, refreshPullRequest } = usePullRequestRefresh(
		{
			workspaceCwd: activeWorkspace.pathLabel ?? null,
			workspaceId: activeWorkspace.id,
		},
	);
	const {
		archiveAfterMergeMutation,
		continueMergedWorkspaceMutation,
		mergeMutation,
		pushBranchMutation,
	} = useReviewMutations({
		activeWorkspace,
		mergeSettings,
		onSettled: closeDialog,
	});
	const isAgentWorking = useWorkspaceBusy(activeWorkspace.id);
	const submitToComposer = useComposerSubmit(activeWorkspace.id);
	const commitAndPush = useCallback(() => {
		if (!submitToComposer(buildCommitAndPushPrompt(activeWorkspace))) {
			toast.error('Open a chat tab to hand this to the agent.');
			return;
		}
		toast.success('Asked the agent to commit and push.');
	}, [activeWorkspace, submitToComposer]);

	const value = useMemo<ReviewActionsValue>(
		() => ({
			archiveMergedWorkspace: () => archiveAfterMergeMutation.mutate(),
			commitAndPush,
			continueMergedWorkspace: () => continueMergedWorkspaceMutation.mutate(),
			isAgentWorking,
			isArchivingMergedWorkspace: archiveAfterMergeMutation.isPending,
			isContinuingMergedWorkspace: continueMergedWorkspaceMutation.isPending,
			isPushingBranch: pushBranchMutation.isPending,
			isRefreshingPullRequest,
			openMergeConfirmation: () => setActiveDialog({ kind: 'merge' }),
			pushBranch: () => pushBranchMutation.mutate(),
			refreshPullRequest,
			runAgentAction,
		}),
		[
			archiveAfterMergeMutation,
			commitAndPush,
			continueMergedWorkspaceMutation,
			isAgentWorking,
			isRefreshingPullRequest,
			pushBranchMutation,
			refreshPullRequest,
			runAgentAction,
		],
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
