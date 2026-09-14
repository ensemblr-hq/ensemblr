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
 * Confirmation shown before closing a tab that still has work in flight. Closing
 * a running chat cancels its agent (see {@link useCloseRunningChatGuard}), so we
 * make the user opt into that rather than silently aborting an in-flight turn.
 *
 * The two reasons a close is held are independent and the dialog states both.
 * A turn in flight leads, because cancelling it is what confirming actually
 * does; a background task earns its own sentence beneath, because it outlives
 * the turn and this chat is the user's only window onto it. A chat held for
 * background tasks alone gets that sentence as its whole copy, since the
 * turn-cancel line would be a lie there.
 *
 * Default focus lands on Cancel (Radix focuses the first focusable child), so a
 * stray Enter never destroys work; ⌘/Ctrl+↵ is the deliberate confirm.
 */
export function CloseRunningChatDialog({
	backgroundTaskCount,
	isRunningTurn,
	onCancel,
	onConfirm,
	open,
}: {
	/** Background tasks still running; zero when the chat has none. */
	backgroundTaskCount: number;
	/** True when the chat's own turn is in flight, so confirming cancels it. */
	isRunningTurn: boolean;
	/** Dismisses the dialog and keeps the chat open. */
	onCancel: () => void;
	/** Cancels the agent and closes the chat. */
	onConfirm: () => void;
	open: boolean;
}) {
	const { t } = useTranslation();
	const holdsBackgroundTasks = backgroundTaskCount > 0;
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
						{isRunningTurn
							? t('workbench:close-running-chat.title', 'Close running chat?')
							: t(
									'workbench:close-running-chat.background-title',
									'Close chat with background tasks?',
								)}
					</DialogTitle>
					<p className='text-muted-foreground text-xs'>
						{isRunningTurn
							? t(
									'workbench:close-running-chat.description',
									'This chat is currently running. Closing it will stop the current agent session.',
								)
							: t('workbench:close-running-chat.background-description', {
									count: backgroundTaskCount,
									defaultValue_one:
										'This chat still has {{count}} background task running. Closing it loses the only place that work is visible.',
									defaultValue_other:
										'This chat still has {{count}} background tasks running. Closing it loses the only place that work is visible.',
								})}
					</p>
					{isRunningTurn && holdsBackgroundTasks ? (
						<p className='text-muted-foreground text-xs'>
							{t('workbench:close-running-chat.background-also', {
								count: backgroundTaskCount,
								defaultValue_one:
									'Closing also ends the {{count}} background task it left running.',
								defaultValue_other:
									'Closing also ends the {{count}} background tasks it left running.',
							})}
						</p>
					) : null}
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
						{t('workbench:close-running-chat.confirm', 'Close anyway')}
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
