import { ListPlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/renderer/components/ui/popover';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import type { QueuedFollowUp } from '@/renderer/types/workbench';
import { FollowUpQueueList } from './follow-up-queue-list';

/** Wiring for the composer's queue chip and the panel behind it. */
interface FollowUpQueuePanelProps {
	disabled?: boolean;
	entries: readonly QueuedFollowUp[];
	/** True while the queue is paused after a stop or a failed send. */
	held: boolean;
	onClear: () => void;
	/** Null while the composer holds a draft an edit would have to clobber. */
	onEdit: ((id: string) => void) | null;
	onMove: (id: string, direction: 'down' | 'up') => void;
	onRemove: (id: string) => void;
	onReorder: (orderedIds: readonly string[]) => void;
	/** Resumes a paused queue, sending the head straight away when the agent is idle. */
	onSendNow: () => void;
}

/**
 * Composer chip listing the messages waiting for the current turn to end, and
 * the panel that lets the user edit, reorder, or take one back.
 *
 * Rendered only when something is queued, matching how the context gauge and the
 * MCP roster are conditional — a chip reading zero would be the only way to open
 * an empty panel, which is a door onto nothing.
 */
export function FollowUpQueuePanel({
	disabled,
	entries,
	held,
	onClear,
	onEdit,
	onMove,
	onRemove,
	onReorder,
	onSendNow,
}: FollowUpQueuePanelProps) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);

	if (entries.length === 0) {
		return null;
	}

	const label = t('workbench:follow-up-queue.aria-label', {
		count: entries.length,
		defaultValue_one: '{{count}} message queued',
		defaultValue_other: '{{count}} messages queued',
	});

	return (
		<Popover onOpenChange={setOpen} open={open}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<Button
							aria-label={label}
							className='h-7 gap-1 rounded-md px-2 font-medium'
							disabled={disabled}
							size='sm'
							type='button'
							variant='subtle'
						>
							<ListPlusIcon className='size-3.5' />
							<span className='text-xs tabular-nums'>{entries.length}</span>
						</Button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent sideOffset={4}>{label}</TooltipContent>
			</Tooltip>
			<PopoverContent align='start' className='w-80 overflow-hidden p-1.5'>
				<div className='flex items-center justify-between gap-2 px-1 pb-1'>
					<span className='text-muted-foreground text-xs'>
						{held
							? t('workbench:follow-up-queue.paused', 'Queued · paused')
							: t('workbench:follow-up-queue.heading', 'Queued')}
					</span>
					<div className='flex items-center gap-1'>
						{held ? (
							<Button
								className='h-6 rounded-md px-2 text-xs'
								onClick={onSendNow}
								size='sm'
								type='button'
								variant='ghost'
							>
								{t('workbench:follow-up-queue.send-now', 'Send now')}
							</Button>
						) : null}
						<Button
							className='h-6 rounded-md px-2 text-xs'
							onClick={() => {
								onClear();
								setOpen(false);
							}}
							size='sm'
							type='button'
							variant='ghost'
						>
							{t('workbench:follow-up-queue.clear', 'Clear all')}
						</Button>
					</div>
				</div>
				<FollowUpQueueList
					entries={entries}
					onEdit={
						onEdit === null
							? null
							: (id) => {
									onEdit(id);
									setOpen(false);
								}
					}
					onMove={onMove}
					onReorder={onReorder}
					onRemove={(id) => {
						onRemove(id);
						if (entries.length === 1) {
							setOpen(false);
						}
					}}
				/>
			</PopoverContent>
		</Popover>
	);
}
