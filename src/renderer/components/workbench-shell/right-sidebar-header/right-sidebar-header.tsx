import { useAtomValue } from 'jotai';
import {
	ArchiveIcon,
	ExternalLinkIcon,
	FastForwardIcon,
	GitMergeIcon,
	LoaderCircleIcon,
	MoreVerticalIcon,
	RefreshCwIcon,
} from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { useReviewableChanges } from '@/renderer/hooks/workbench-shell/review-files/use-reviewable-changes';
import { cn } from '@/renderer/lib/utils';
import { getRightSidebarHeaderState } from '@/renderer/lib/workbench/right-sidebar-header-state';
import { continuedMergedPullRequestByWorkspaceAtom } from '@/renderer/state/workspace';
import type {
	RightSidebarHeaderState,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import {
	classifyPermissionAction,
	DEFAULT_PERMISSION_MODE,
	getPermissionBoundaryLabel,
} from '@/shared/permissions';
import { useReviewActions } from '../review-actions/review-actions-context';
import { CreatePullRequestMenu } from './create-pull-request-menu';
import { PreviewDeploymentButton } from './preview-deployment-button';
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
	merged: 'text-[color:var(--right-sidebar-header-merged)]',
	ready: 'text-status-ok',
};

const archiveBoundary = classifyPermissionAction({
	action: 'workspace-archive-delete',
	mode: DEFAULT_PERMISSION_MODE,
});
const mergeBoundary = classifyPermissionAction({
	action: 'pull-request-merge',
	mode: DEFAULT_PERMISSION_MODE,
});
const mergeBoundaryLabel = getPermissionBoundaryLabel(mergeBoundary.boundary);

/** Header above the review sidebar — shows PR number, tone, and primary action. */
export function RightSidebarHeader({
	activeWorkspace,
}: {
	activeWorkspace: WorkspaceShellModel;
}) {
	const headerState = useRightSidebarHeaderState(activeWorkspace);
	const hasPullRequestNumber = 'number' in headerState;
	const hasHeaderLabel = 'label' in headerState;

	return (
		<header
			className='native-toolbar right-sidebar-header flex h-12 w-full shrink-0 items-center gap-3 border-border border-b px-3'
			data-pr-tone={headerState.tone}
		>
			<div className='flex min-w-0 flex-1 items-center gap-2.5'>
				{hasPullRequestNumber ? (
					<RightSidebarHeaderPullRequestLinks headerState={headerState} />
				) : null}
				{hasHeaderLabel ? (
					<p
						className={cn(
							'min-w-0 truncate font-semibold text-sm leading-none',
							HEADER_LABEL_TONE_CLASSES[headerState.tone],
						)}
					>
						{headerState.label}
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

/** Compact PR controls shown in the main toolbar when the review sidebar is collapsed. */
export function RightSidebarHeaderInlineActions({
	activeWorkspace,
}: {
	activeWorkspace: WorkspaceShellModel;
}) {
	const headerState = useRightSidebarHeaderState(activeWorkspace);
	const hasPullRequestNumber = 'number' in headerState;

	if (!hasPullRequestNumber && headerState.kind === 'empty') {
		return null;
	}

	return (
		<div
			className='right-sidebar-header-actions flex shrink-0 items-center gap-2'
			data-pr-tone={headerState.tone}
		>
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
 * next `gh` snapshot lands.
 * @param activeWorkspace - Workspace the header renders for.
 * @returns The resolved header state.
 */
function useRightSidebarHeaderState(
	activeWorkspace: WorkspaceShellModel,
): RightSidebarHeaderState {
	const hasBranchChanges = useReviewableChanges(activeWorkspace);
	const continuedMergedPullRequests = useAtomValue(
		continuedMergedPullRequestByWorkspaceAtom,
	);

	return getRightSidebarHeaderState(activeWorkspace, hasBranchChanges, {
		continuedPullRequestNumber: continuedMergedPullRequests[activeWorkspace.id],
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

/** Dispatches the header's trailing action based on the resolved header state. */
function RightSidebarHeaderAction({
	activeWorkspace,
	headerState,
}: {
	activeWorkspace: WorkspaceShellModel;
	headerState: RightSidebarHeaderState;
}) {
	const reviewActions = useReviewActions();

	switch (headerState.kind) {
		case 'pr-ready':
			return (
				<Button
					className='h-7 rounded-md bg-status-ok px-2.5 text-primary-foreground hover:bg-status-ok/90'
					data-permission-boundary={mergeBoundary.boundary}
					onClick={reviewActions?.openMergeConfirmation}
					size='sm'
				>
					<GitMergeIcon data-icon='inline-start' />
					Merge
					<span className='sr-only'>{mergeBoundaryLabel}</span>
				</Button>
			);
		case 'pr-merged':
			return (
				<div className='flex items-center gap-1.5'>
					<Button
						className='h-8 rounded-lg border-[color:var(--right-sidebar-header-merged-border)] border-dashed bg-background/70 px-2.5 text-[color:var(--right-sidebar-header-merged)] text-sm hover:bg-[var(--right-sidebar-header-merged-soft)] hover:text-[color:var(--right-sidebar-header-merged)] dark:border-[color:var(--right-sidebar-header-merged-border)] dark:bg-background/65 dark:hover:bg-[var(--right-sidebar-header-merged-soft)]'
						disabled={
							reviewActions === null ||
							reviewActions.isArchivingMergedWorkspace ||
							reviewActions.isContinuingMergedWorkspace
						}
						onClick={reviewActions?.continueMergedWorkspace}
						size='sm'
						variant='outline'
					>
						{reviewActions?.isContinuingMergedWorkspace ? (
							<LoaderCircleIcon
								aria-hidden='true'
								className='animate-spin'
								data-icon='inline-start'
							/>
						) : (
							<FastForwardIcon aria-hidden='true' data-icon='inline-start' />
						)}
						Continue
					</Button>
					<Button
						className='h-8 rounded-lg bg-[var(--right-sidebar-header-merged)] px-2.5 text-[color:var(--right-sidebar-header-merged-foreground)] text-sm hover:bg-[var(--right-sidebar-header-merged-hover)]'
						data-permission-boundary={archiveBoundary.boundary}
						disabled={
							reviewActions === null ||
							reviewActions.isArchivingMergedWorkspace ||
							reviewActions.isContinuingMergedWorkspace
						}
						onClick={reviewActions?.archiveMergedWorkspace}
						size='sm'
					>
						{reviewActions?.isArchivingMergedWorkspace ? (
							<LoaderCircleIcon
								aria-hidden='true'
								className='animate-spin'
								data-icon='inline-start'
							/>
						) : (
							<ArchiveIcon aria-hidden='true' data-icon='inline-start' />
						)}
						Archive
					</Button>
				</div>
			);
		case 'pr-working':
		case 'pr-checking':
			return (
				<output
					aria-label='Pull request activity in progress'
					className='grid size-7 place-items-center text-muted-foreground'
				>
					<LoaderCircleIcon
						aria-hidden='true'
						className='size-4 animate-spin'
					/>
				</output>
			);
		case 'create-pr':
			return <CreatePullRequestMenu workspace={activeWorkspace} />;
		case 'pr-blocked':
		case 'pr-open':
			return (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button size='icon-sm' variant='ghost'>
							<MoreVerticalIcon />
							<span className='sr-only'>Open pull request menu</span>
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align='end'>
						<DropdownMenuItem
							disabled={reviewActions?.isRefreshingPullRequest}
							onSelect={() => reviewActions?.refreshPullRequest()}
						>
							<RefreshCwIcon aria-hidden='true' />
							Refresh PR status
						</DropdownMenuItem>
						{headerState.url ? (
							<DropdownMenuItem asChild>
								<a href={headerState.url} rel='noreferrer' target='_blank'>
									<ExternalLinkIcon aria-hidden='true' />
									Open on GitHub
								</a>
							</DropdownMenuItem>
						) : null}
						<DropdownMenuItem
							onSelect={() => reviewActions?.openMergeConfirmation()}
						>
							<GitMergeIcon aria-hidden='true' />
							Merge…
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			);
		case 'empty':
			return null;
	}
}
