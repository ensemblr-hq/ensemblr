import {
	ExternalLinkIcon,
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
import { getRightSidebarHeaderState } from './state';

/** Tone values extracted from {@link RightSidebarHeaderState}. */
type HeaderTone = RightSidebarHeaderState extends { tone: infer T } ? T : never;

const HEADER_LABEL_TONE_CLASSES: Record<HeaderTone, string> = {
	blocked: 'text-status-danger',
	neutral: 'text-muted-foreground',
	pending: 'text-foreground',
	ready: 'text-status-ok',
};

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
	const hasBranchChanges = useReviewableChanges(activeWorkspace);
	const headerState = getRightSidebarHeaderState(
		activeWorkspace,
		hasBranchChanges,
	);
	const hasPullRequestNumber = 'number' in headerState;
	const hasHeaderLabel = 'label' in headerState;

	return (
		<header
			className='native-toolbar right-sidebar-header flex h-12 w-full shrink-0 items-center gap-3 border-border border-b px-3'
			data-pr-tone={headerState.tone}
		>
			<div className='flex min-w-0 flex-1 items-center gap-2.5'>
				{hasPullRequestNumber ? (
					<div className='flex shrink-0 items-center gap-1'>
						<PullRequestNumberButton
							number={headerState.number}
							tone={headerState.tone}
							url={headerState.url}
						/>
						{headerState.previewDeployment ? (
							<PreviewDeploymentButton
								deployment={headerState.previewDeployment}
							/>
						) : null}
					</div>
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
