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

/**
 * Which review dialog is currently open and the workspace it was opened for, or
 * null when none is. The workspace is part of the state because the provider
 * outlives a switch and the dialog must not follow the shell onto the next one.
 */
type ActiveReviewDialog = { kind: 'merge'; workspaceId: string } | null;

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
 * A dialog is abandoned when the shell leaves the workspace it was opened for.
 * The route component is reused across workspace params, so this state survives
 * a switch the same way the review mutations do, and a confirmation raised for
 * one workspace would otherwise re-render against — and merge — the next one.
 * Dropped during render rather than from an effect: an effect runs after paint,
 * which is one frame of a dialog naming the wrong pull request.
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

	if (
		activeDialog !== null &&
		activeDialog.workspaceId !== activeWorkspace.id
	) {
		setActiveDialog(null);
	}

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
		archiveMergedWorkspace,
		continueMergedWorkspace,
		isArchivingMergedWorkspace,
		isContinuingMergedWorkspace,
		isMerging,
		isPushingBranch,
		merge,
		pushBranch,
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
			archiveMergedWorkspace,
			commitAndPush,
			continueMergedWorkspace,
			handOffToChat,
			isAgentWorking,
			isArchivingMergedWorkspace,
			isContinuingMergedWorkspace,
			isPushingBranch,
			isRefreshingPullRequest,
			openMergeConfirmation: () =>
				setActiveDialog({ kind: 'merge', workspaceId: activeWorkspace.id }),
			pullRequestAction,
			pushBranch,
			refreshPullRequest,
			runAgentAction,
		}),
		[
			activeWorkspace.id,
			archiveMergedWorkspace,
			commitAndPush,
			continueMergedWorkspace,
			handOffToChat,
			isAgentWorking,
			isArchivingMergedWorkspace,
			isContinuingMergedWorkspace,
			isPushingBranch,
			isRefreshingPullRequest,
			pullRequestAction,
			pushBranch,
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
				isSubmitting={isMerging}
				onConfirm={merge}
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
