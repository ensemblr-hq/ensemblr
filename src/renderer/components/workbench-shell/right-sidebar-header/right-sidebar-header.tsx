import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';

import { useReviewableChanges } from '@/renderer/hooks/workbench-shell/review-files/use-reviewable-changes';
import { useWorkspaceConflicts } from '@/renderer/hooks/workbench-shell/review-files/use-workspace-conflicts';
import { cn } from '@/renderer/lib/utils';
import { getRightSidebarHeaderState } from '@/renderer/lib/workbench/right-sidebar-header-state';
import { continuedMergedPullRequestByWorkspaceAtom } from '@/renderer/state/workspace';
import type {
	RightSidebarHeaderState,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import { useReviewActions } from '../review-actions/review-actions-context';
import { CreatePullRequestMenu } from './create-pull-request-menu';
import {
	CommitAndPushAction,
	HeaderActivitySpinner,
	MergePullRequestAction,
	PushBranchAction,
} from './header-action-buttons';
import { MergedHeaderActions } from './merged-header-actions';
import { PreviewDeploymentButton } from './preview-deployment-button';
import { PullRequestMenu } from './pull-request-menu';
import { PullRequestNumberButton } from './pull-request-number-button';

/** Tone values extracted from {@link RightSidebarHeaderState}. */
type HeaderTone = RightSidebarHeaderState extends { tone: infer T } ? T : never;

/** Header states that can link to an existing PR and deployment. */
type RightSidebarHeaderNumberedState = Extract<
	RightSidebarHeaderState,
	{ number: number }
>;

const HEADER_LABEL_TONE_CLASSES: Record<HeaderTone, string> = {
	blocked: 'text-status-danger',
	neutral: 'text-muted-foreground',
	pending: 'text-foreground',
	merged: 'text-pr-merged',
	ready: 'text-status-ok',
};

/**
 * Header above the review sidebar — shows PR number, tone, and primary action.
 * The row holding the pills and the status label is the `pr-header` query
 * container: it measures the space left after the trailing action, which is what
 * {@link PreviewDeploymentButton} collapses its text label against. The class
 * belongs on that row because `flex-1` sizes it from the outside; an
 * `inline-size` container that took its width from its own contents would
 * measure itself as empty and collapse to zero.
 */
export function RightSidebarHeader({
	activeWorkspace,
}: {
	activeWorkspace: WorkspaceShellModel;
}) {
	const headerState = useRightSidebarHeaderState(activeWorkspace);
	const hasPullRequestNumber = 'number' in headerState;
	const headerLabel = 'label' in headerState ? headerState.label : '';

	return (
		<header
			className='native-toolbar right-sidebar-header flex h-12 w-full shrink-0 items-center gap-3 border-border border-b px-3'
			data-pr-tone={headerState.tone}
		>
			<div className='@container/pr-header flex min-w-0 flex-1 items-center gap-2.5'>
				{hasPullRequestNumber ? (
					<RightSidebarHeaderPullRequestLinks headerState={headerState} />
				) : null}
				{headerLabel ? (
					<p
						className={cn(
							'min-w-0 truncate font-semibold text-sm leading-none',
							HEADER_LABEL_TONE_CLASSES[headerState.tone],
						)}
					>
						{headerLabel}
					</p>
				) : null}
			</div>
			<div className='ml-auto flex shrink-0 items-center justify-end'>
				<RightSidebarHeaderAction
					activeWorkspace={activeWorkspace}
					headerState={headerState}
				/>
			</div>
		</header>
	);
}

/**
 * Compact PR controls shown in the main toolbar when the review sidebar is
 * collapsed. This row is deliberately not a `pr-header` container: the toolbar
 * sizes it from its own contents, so making it one would collapse it to zero
 * width. The preview pill keeps its text label here and the branch name beside
 * it truncates instead.
 */
export function RightSidebarHeaderInlineActions({
	activeWorkspace,
}: {
	activeWorkspace: WorkspaceShellModel;
}) {
	const headerState = useRightSidebarHeaderState(activeWorkspace);
	const hasPullRequestNumber = 'number' in headerState;

	if (
		!hasPullRequestNumber &&
		headerState.kind === 'empty' &&
		!headerState.isAgentWorking
	) {
		return null;
	}

	return (
		<div className='flex shrink-0 items-center gap-2'>
			{hasPullRequestNumber ? (
				<RightSidebarHeaderPullRequestLinks headerState={headerState} />
			) : null}
			<RightSidebarHeaderAction
				activeWorkspace={activeWorkspace}
				headerState={headerState}
			/>
		</div>
	);
}

/**
 * Resolves the header state for a workspace, honouring the locally dismissed
 * merged PR so a continued workspace stops showing the merged header before the
 * next `gh` snapshot lands, the live agent-busy flag the review provider
 * publishes so the header freezes for the length of an agent turn, and the same
 * conflict probe the Checks panel and Changes list read so all three agree.
 *
 * Every header label comes back already translated, off the `i18n` singleton
 * React cannot observe, so this hook subscribes its caller to `languageChanged`
 * on their behalf.
 *
 * @param activeWorkspace - Workspace the header renders for.
 * @returns The resolved header state.
 */
function useRightSidebarHeaderState(
	activeWorkspace: WorkspaceShellModel,
): RightSidebarHeaderState {
	useTranslation();
	const hasBranchChanges = useReviewableChanges(activeWorkspace);
	const reviewActions = useReviewActions();
	const { paths: conflictPaths } = useWorkspaceConflicts(activeWorkspace);
	const continuedMergedPullRequests = useAtomValue(
		continuedMergedPullRequestByWorkspaceAtom,
	);

	return getRightSidebarHeaderState(activeWorkspace, hasBranchChanges, {
		agentBusy: reviewActions?.isAgentWorking === true,
		continuedPullRequestNumber: continuedMergedPullRequests[activeWorkspace.id],
		hasConflicts: conflictPaths.size > 0,
	});
}

/** Renders the existing pull request and preview deployment links. */
function RightSidebarHeaderPullRequestLinks({
	headerState,
}: {
	headerState: RightSidebarHeaderNumberedState;
}) {
	return (
		<div className='flex shrink-0 items-center gap-1'>
			<PullRequestNumberButton
				number={headerState.number}
				tone={headerState.tone}
				url={headerState.url}
			/>
			{headerState.previewDeployment ? (
				<PreviewDeploymentButton
					deployment={headerState.previewDeployment}
					tone={headerState.tone}
				/>
			) : null}
		</div>
	);
}

/**
 * Dispatches the header's trailing action based on the resolved header state.
 * An agent turn replaces every action with a spinner: whatever the action would
 * commit, merge, or push is about to move under it.
 */
function RightSidebarHeaderAction({
	activeWorkspace,
	headerState,
}: {
	activeWorkspace: WorkspaceShellModel;
	headerState: RightSidebarHeaderState;
}) {
	const { t } = useTranslation();

	if (headerState.isAgentWorking) {
		return (
			<HeaderActivitySpinner
				label={t('git:pull-request-header.agent-working', 'Agent working')}
			/>
		);
	}

	switch (headerState.kind) {
		case 'pr-ready':
			return <MergePullRequestAction />;
		case 'pr-merged':
			return <MergedHeaderActions />;
		case 'pr-checking':
			return (
				<HeaderActivitySpinner
					label={t(
						'git:pull-request-header.activity',
						'Pull request activity in progress',
					)}
				/>
			);
		case 'pr-uncommitted':
			return <CommitAndPushAction />;
		case 'pr-unpushed':
			return <PushBranchAction />;
		case 'create-pr':
			return <CreatePullRequestMenu workspace={activeWorkspace} />;
		case 'pr-blocked':
		case 'pr-open':
			return (
				<PullRequestMenu
					hasConflicts={headerState.hasConflicts}
					url={headerState.url}
				/>
			);
		case 'empty':
			return null;
	}
}
