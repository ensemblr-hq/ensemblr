import { Button } from '@/renderer/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';

import type { CheckpointRestoreTarget } from '@/renderer/hooks/workbench-shell/timeline/use-checkpoint-restore';

/** Destructive-action confirmation for restoring a turn checkpoint. */
export function RestoreCheckpointDialog({
	hasOtherOpenSessions,
	onCancel,
	onConfirm,
	target,
}: {
	hasOtherOpenSessions: boolean;
	onCancel: () => void;
	onConfirm: () => void;
	target: CheckpointRestoreTarget | null;
}) {
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					onCancel();
				}
			}}
			open={target !== null}
		>
			<DialogContent className='gap-4 sm:max-w-lg'>
				<DialogHeader>
					<DialogTitle>Restore workspace to before this turn?</DialogTitle>
					<DialogDescription className='space-y-2'>
						<span className='block'>
							Workspace files revert to the snapshot taken before “
							{target?.label}”. Later messages in this chat are hidden from the
							timeline, but Pi’s own session history is never modified — you can
							keep prompting from the restored state.
						</span>
						<span className='block'>
							Files created after the snapshot that were never tracked stay in
							place.
						</span>
						{hasOtherOpenSessions ? (
							<span className='block font-medium text-status-warning'>
								Another chat session is active in this workspace; its newer file
								changes may be overwritten by this restore.
							</span>
						) : null}
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button onClick={onCancel} variant='ghost'>
						Cancel
					</Button>
					<Button onClick={onConfirm} variant='destructive'>
						Restore workspace
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
