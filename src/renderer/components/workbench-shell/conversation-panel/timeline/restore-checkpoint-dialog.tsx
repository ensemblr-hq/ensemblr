import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';

import type { CheckpointRestoreTarget } from '@/renderer/types/workbench';

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
	const { t } = useTranslation();
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
					<DialogTitle>
						{t(
							'workbench:restore-checkpoint.title',
							'Restore workspace to before this turn?',
						)}
					</DialogTitle>
					<DialogDescription className='space-y-2'>
						<span className='block'>
							{t(
								'workbench:restore-checkpoint.description',
								'Workspace files revert to the snapshot taken before “{{label}}”. Later messages in this chat are hidden from the timeline, but the agent’s own session history is never modified — you can keep prompting from the restored state.',
								{ label: target?.label ?? '' },
							)}
						</span>
						<span className='block'>
							{t(
								'workbench:restore-checkpoint.untracked',
								'Files created after the snapshot that were never tracked stay in place.',
							)}
						</span>
						{hasOtherOpenSessions ? (
							<span className='block font-medium text-status-warning'>
								{t(
									'workbench:restore-checkpoint.other-sessions',
									'Another chat session is active in this workspace; its newer file changes may be overwritten by this restore.',
								)}
							</span>
						) : null}
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button onClick={onCancel} variant='ghost'>
						{t('common:actions.cancel', 'Cancel')}
					</Button>
					<Button onClick={onConfirm} variant='destructive'>
						{t('workbench:restore-checkpoint.confirm', 'Restore workspace')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
