import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { reviewMergeSettingsQuery } from '@/renderer/api/ensemblr-queries';
import { usePullRequestRefresh } from '@/renderer/hooks/workbench-shell/review-actions/use-pull-request-refresh';
import { useReviewMenuCommands } from '@/renderer/hooks/workbench-shell/review-actions/use-review-menu-commands';
import { useReviewMutations } from '@/renderer/hooks/workbench-shell/review-actions/use-review-mutations';
import { useWorkspaceBusy } from '@/renderer/hooks/workspace/use-workspace-busy';
import { resolvePullRequestAction } from '@/renderer/lib/workbench/action-prompts';
import { buildCommitAndPushPrompt } from '@/renderer/lib/workbench/checks-pr-prompts';
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
	reclaimDiskOnArchive: true,
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
	handOffToChat,
	runAgentAction,
}: {
	activeProject: ProjectShellModel;
	activeWorkspace: WorkspaceShellModel;
	children: ReactNode;
	handOffToChat: (text: string) => boolean;
	runAgentAction: (action: AgentActionKind) => void;
}) {
	const { t } = useTranslation();
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
	const pullRequestAction = resolvePullRequestAction(activeWorkspace);
	const commitAndPush = useCallback(() => {
		if (!handOffToChat(buildCommitAndPushPrompt(activeWorkspace))) {
			toast.error(
				t(
					'errors:composer.chat-tab-not-ready.title',
					'This workspace has no chat ready yet. Try again in a moment.',
				),
			);
			return;
		}
		toast.success(
			t(
				'git:commit-and-push.asked.title',
				'Asked the agent to commit and push.',
			),
		);
	}, [activeWorkspace, handOffToChat, t]);

	const value = useMemo<ReviewActionsValue>(
		() => ({
			archiveMergedWorkspace: () => archiveAfterMergeMutation.mutate(),
			commitAndPush,
			continueMergedWorkspace: () => continueMergedWorkspaceMutation.mutate(),
			handOffToChat,
			isAgentWorking,
			isArchivingMergedWorkspace: archiveAfterMergeMutation.isPending,
			isContinuingMergedWorkspace: continueMergedWorkspaceMutation.isPending,
			isPushingBranch: pushBranchMutation.isPending,
			isRefreshingPullRequest,
			openMergeConfirmation: () => setActiveDialog({ kind: 'merge' }),
			pullRequestAction,
			pushBranch: () => pushBranchMutation.mutate(),
			refreshPullRequest,
			runAgentAction,
		}),
		[
			archiveAfterMergeMutation,
			commitAndPush,
			continueMergedWorkspaceMutation,
			handOffToChat,
			isAgentWorking,
			isRefreshingPullRequest,
			pullRequestAction,
			pushBranchMutation,
			refreshPullRequest,
			runAgentAction,
		],
	);

	useReviewMenuCommands(value);

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
