import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { isEnsemblrApiAvailable } from '@/renderer/api/ensemblr-queries';
import { Button } from '@/renderer/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import type { DiscardChangesTarget } from '@/renderer/types/workbench';

/**
 * Destructive confirmation for discarding working-tree changes. Tracked files
 * revert to HEAD; new/untracked files are deleted — none of it is recoverable,
 * so the action is always gated behind this dialog. The git call itself belongs
 * to `useDiscardChanges`, which owns how the change set settles afterwards.
 */
export function DiscardChangesDialog({
	errorMessage,
	isPending,
	onConfirm,
	onOpenChange,
	open,
	target,
}: {
	errorMessage: string | null;
	isPending: boolean;
	onConfirm: () => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	target: DiscardChangesTarget | null;
}) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className='gap-4 sm:max-w-md'>
				{target ? (
					<DiscardChangesDialogBody
						errorMessage={errorMessage}
						isPending={isPending}
						onConfirm={onConfirm}
						onOpenChange={onOpenChange}
						target={target}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

/** Copy, affected-file summary, and buttons for one pending discard target. */
function DiscardChangesDialogBody({
	errorMessage,
	isPending,
	onConfirm,
	onOpenChange,
	target,
}: {
	errorMessage: string | null;
	isPending: boolean;
	onConfirm: () => void;
	onOpenChange: (open: boolean) => void;
	target: DiscardChangesTarget;
}) {
	const { t } = useTranslation();
	const canDiscard = !isPending && isEnsemblrApiAvailable();
	const isBulk = target.fileCount > 1;

	const handleClose = useCallback(() => {
		onOpenChange(false);
	}, [onOpenChange]);

	return (
		<>
			<DialogHeader>
				<DialogTitle className='font-medium text-[0.9375rem]'>
					{isBulk
						? t('review:discard-changes.title-bulk', 'Discard all changes?')
						: t('review:discard-changes.title', 'Discard changes?')}
				</DialogTitle>
				<p className='text-muted-foreground text-xs'>
					{isBulk
						? t(
								'review:discard-changes.description-bulk',
								'Every working-tree change is reverted to the last commit and any new files are deleted. This cannot be undone.',
							)
						: t(
								'review:discard-changes.description',
								'The working-tree changes are reverted to the last commit; a new file is deleted. This cannot be undone.',
							)}
				</p>
			</DialogHeader>

			<div className='flex flex-col gap-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs'>
				<span className='truncate font-mono text-[0.6875rem]'>
					{target.title}
				</span>
				<span className='text-[0.6875rem] text-muted-foreground'>
					{t('review:discard-changes.affected-file-count', {
						count: target.fileCount,
						defaultValue_one: '{{count}} file affected',
						defaultValue_other: '{{count}} files affected',
					})}
				</span>
			</div>

			{errorMessage ? (
				<p className='text-[0.6875rem] text-status-danger'>{errorMessage}</p>
			) : null}

			<div className='-mx-4 -mb-4 flex justify-end gap-2 rounded-b-xl border-border border-t bg-muted/40 px-4 py-3'>
				<Button
					className='h-8'
					disabled={isPending}
					onClick={handleClose}
					type='button'
					variant='outline'
				>
					{t('common:actions.cancel', 'Cancel')}
				</Button>
				<Button
					className='h-8'
					disabled={!canDiscard}
					onClick={onConfirm}
					pending={isPending}
					type='button'
					variant='destructive'
				>
					{t('common:actions.discard', 'Discard')}
				</Button>
			</div>
		</>
	);
}
