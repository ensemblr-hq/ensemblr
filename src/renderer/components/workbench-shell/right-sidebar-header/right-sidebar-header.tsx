import { GitMergeIcon, LoaderCircleIcon, MoreVerticalIcon } from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import {
	classifyPermissionAction,
	DEFAULT_PERMISSION_MODE,
	getPermissionBoundaryLabel,
} from '@/shared/permissions';

import { CreatePullRequestMenu } from './create-pull-request-menu';
import { PreviewDeploymentButton } from './preview-deployment-button';
import { PullRequestNumberButton } from './pull-request-number-button';
import {
	getRightSidebarHeaderState,
	type RightSidebarHeaderState,
} from './state';

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
	const headerState = getRightSidebarHeaderState(activeWorkspace);
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
							headerState.tone === 'ready' && 'text-status-ok',
							headerState.tone === 'pending' && 'text-foreground',
							headerState.tone === 'blocked' && 'text-status-danger',
							headerState.tone === 'neutral' && 'text-muted-foreground',
						)}
					>
						{headerState.label}
					</p>
				) : null}
			</div>
			<div className='ml-auto flex shrink-0 items-center justify-end'>
				<RightSidebarHeaderAction headerState={headerState} />
			</div>
		</header>
	);
}

/** Dispatches the header's trailing action based on the resolved header state. */
function RightSidebarHeaderAction({
	headerState,
}: {
	headerState: RightSidebarHeaderState;
}) {
	switch (headerState.kind) {
		case 'pr-ready':
			return (
				<Button
					className='h-7 rounded-md bg-status-ok px-2.5 text-primary-foreground hover:bg-status-ok/90'
					data-permission-boundary={mergeBoundary.boundary}
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
			return <CreatePullRequestMenu />;
		case 'pr-blocked':
		case 'pr-open':
			return (
				<Button size='icon-sm' variant='ghost'>
					<MoreVerticalIcon />
					<span className='sr-only'>Open pull request menu</span>
				</Button>
			);
		case 'empty':
			return null;
	}
}
