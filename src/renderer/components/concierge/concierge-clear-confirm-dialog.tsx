import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import { useKeymapHandler } from '@/renderer/hooks/use-keymap-handler';
import type { KeymapBinding } from '@/renderer/types/keymap';
import { formatChord } from '@/shared/keymap';

/**
 * Confirmation shown before clearing the context out from under a turn the
 * Concierge is still streaming.
 *
 * A clear replaces the conversation, so pressed mid-answer it throws away work
 * the user is watching arrive — and the control sits one click from the maximize
 * button and one chord from ⌘⇧M. It guards the chord and the menu item as much
 * as the button, because all three run the same action and a chord that skipped
 * the question would be the easiest of the three to hit by accident.
 *
 * Default focus lands on Cancel (Radix focuses the first focusable child), so a
 * stray Enter never destroys the turn; ⌘/Ctrl+↵ is the deliberate confirm.
 */
export function ConciergeClearConfirmDialog({
	onCancel,
	onConfirm,
	open,
}: {
	/** Dismisses the dialog and leaves the turn streaming. */
	onCancel: () => void;
	/** Throws the conversation away and starts a fresh one. */
	onConfirm: () => void;
	open: boolean;
}) {
	const { t } = useTranslation();
	const submitBindings = useMemo<readonly KeymapBinding<HTMLDivElement>[]>(
		() => [
			[
				'dialog.submit',
				() => {
					onConfirm();
				},
			],
		],
		[onConfirm],
	);
	const handleSubmitKey = useKeymapHandler(submitBindings);

	return (
		<Dialog
			onOpenChange={(next) => {
				if (!next) {
					onCancel();
				}
			}}
			open={open}
		>
			<DialogContent
				className='gap-4 sm:max-w-md'
				onKeyDown={handleSubmitKey}
				showCloseButton={false}
			>
				<DialogHeader>
					<DialogTitle className='font-medium text-[0.9375rem]'>
						{t(
							'workbench:concierge.clear-confirm.title',
							'Clear context while the Concierge is working?',
						)}
					</DialogTitle>
					<p className='text-muted-foreground text-xs'>
						{t(
							'workbench:concierge.clear-confirm.description',
							'The Concierge is still answering. Clearing now stops this turn and starts a fresh conversation; what it has written so far is kept in its memory.',
						)}
					</p>
				</DialogHeader>

				<div className='-mx-4 -mb-4 flex justify-end gap-2 rounded-b-xl border-border border-t bg-muted/40 px-4 py-3'>
					<Button
						className='h-8'
						onClick={onCancel}
						type='button'
						variant='outline'
					>
						{t('common:actions.cancel', 'Cancel')}
					</Button>
					<Button
						className='h-8 gap-2'
						onClick={onConfirm}
						type='button'
						variant='destructive'
					>
						{t('workbench:concierge.clear-confirm.confirm', 'Clear anyway')}
						{/* i18next-instrument-ignore */}
						<span
							aria-hidden='true'
							className='ml-1 inline-flex items-center gap-0.5 text-[0.6875rem] opacity-70'
						>
							{formatChord(['mod'], 'Enter')}
						</span>
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
