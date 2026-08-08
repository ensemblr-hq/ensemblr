import { ArchiveIcon, FastForwardIcon, LoaderCircleIcon } from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';
import {
	classifyPermissionAction,
	DEFAULT_PERMISSION_MODE,
} from '@/shared/permissions';

import { useReviewActions } from '../review-actions/review-actions-context';
import { HEADER_ACTION_BUTTON_CLASSES } from './header-action-buttons';

const archiveBoundary = classifyPermissionAction({
	action: 'workspace-archive-delete',
	mode: DEFAULT_PERMISSION_MODE,
});

/**
 * Post-merge header actions: branch onto a successor and keep working, or
 * archive the workspace. Either one running disables both, since they are
 * mutually exclusive endings for the same workspace.
 */
export function MergedHeaderActions() {
	const reviewActions = useReviewActions();
	const isBusy =
		reviewActions === null ||
		reviewActions.isArchivingMergedWorkspace ||
		reviewActions.isContinuingMergedWorkspace;

	return (
		<div className='flex items-center gap-1.5'>
			<Button
				className='h-7 rounded-md border-pr-merged-border border-dashed bg-background/70 px-2.5 text-pr-merged hover:bg-pr-merged-soft hover:text-pr-merged dark:border-pr-merged-border dark:bg-background/65 dark:hover:bg-pr-merged-soft'
				disabled={isBusy}
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
				className={HEADER_ACTION_BUTTON_CLASSES}
				data-permission-boundary={archiveBoundary.boundary}
				disabled={isBusy}
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
}
