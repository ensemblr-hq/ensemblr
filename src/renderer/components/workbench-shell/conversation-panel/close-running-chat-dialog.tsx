import { useMemo } from 'react';

import { Button } from '@/renderer/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import { useKeymapHandler } from '@/renderer/hooks/use-keymap-handler';
import type { KeymapBinding } from '@/renderer/types/keymap';

/**
 * Confirmation shown before closing a tab whose agent is still running. Closing
 * a running chat cancels its agent (see {@link useCloseRunningChatGuard}), so we
 * make the user opt into that rather than silently aborting an in-flight turn.
 *
 * Default focus lands on Cancel (Radix focuses the first focusable child), so a
 * stray Enter never destroys work; ⌘/Ctrl+↵ is the deliberate confirm.
 */
export function CloseRunningChatDialog({
	onCancel,
	onConfirm,
	open,
}: {
	/** Dismisses the dialog and keeps the chat open. */
	onCancel: () => void;
	/** Cancels the agent and closes the chat. */
	onConfirm: () => void;
	open: boolean;
}) {
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
						Close running chat?
					</DialogTitle>
					<p className='text-muted-foreground text-xs'>
						This chat is currently running. Closing it will stop the current Pi
						session.
					</p>
				</DialogHeader>

				<div className='-mx-4 -mb-4 flex justify-end gap-2 rounded-b-xl border-border border-t bg-muted/40 px-4 py-3'>
					<Button
						className='h-8'
						onClick={onCancel}
						type='button'
						variant='outline'
					>
						Cancel
					</Button>
					<Button
						className='h-8 gap-2'
						onClick={onConfirm}
						type='button'
						variant='destructive'
					>
						Close anyway
						<span
							aria-hidden='true'
							className='ml-1 inline-flex items-center gap-0.5 text-[0.6875rem] opacity-70'
						>
							⌘↵
						</span>
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
