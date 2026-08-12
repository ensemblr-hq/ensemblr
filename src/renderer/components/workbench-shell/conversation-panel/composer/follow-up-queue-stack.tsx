import { ClockIcon, PauseIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';
import type { QueuedFollowUp } from '@/renderer/types/workbench';
import { FollowUpQueueList } from './follow-up-queue-list';

/** Wiring for the stack of queued messages sitting above the composer. */
interface FollowUpQueueStackProps {
	entries: readonly QueuedFollowUp[];
	onClear: () => void;
	/** Null while the composer holds a draft an edit would have to clobber. */
	onEdit: ((id: string) => void) | null;
	onMove: (id: string, direction: 'down' | 'up') => void;
	onRemove: (id: string) => void;
	onReorder: (orderedIds: readonly string[]) => void;
	/** Resumes a paused queue, sending the head straight away when the agent is idle. */
	onSendNow: () => void;
	/** Sends one entry out of turn; null while the composer cannot send at all. */
	onSteer: ((id: string) => void) | null;
	/** True once a stop or a failed send has paused the queue outright. */
	paused: boolean;
	/** True while the queue waits on the user rather than on the agent. */
	stalled: boolean;
	streaming: boolean;
}

/**
 * Why the queue is sitting still, which is the one thing the old chip could not
 * say without being opened. `draining` goes on its own when the turn ends;
 * `paused` was stopped and stays stopped; `waiting` is the `block` behavior
 * holding a message the user has to release by hand.
 */
type QueueStatus = 'draining' | 'paused' | 'waiting';

/**
 * The stack of messages waiting for the current turn to end, pinned above the
 * composer and visible the whole time something is queued.
 *
 * It replaced a counter chip that opened a popover, which left the queue's whole
 * meaning — what is in it, which one goes first, and whether it moves on its own
 * — behind a click most people never made. Rendered only when something is
 * queued: an empty stack would be a permanent strip saying nothing.
 *
 * The header keeps a fixed height and seats its status icon in a column the
 * width of a row's drag handle, so the label lines up with the message text
 * below it and the strip does not resize when the resume button comes and goes.
 */
export function FollowUpQueueStack({
	entries,
	onClear,
	onEdit,
	onMove,
	onRemove,
	onReorder,
	onSendNow,
	onSteer,
	paused,
	stalled,
	streaming,
}: FollowUpQueueStackProps) {
	const { t } = useTranslation();

	if (entries.length === 0) {
		return null;
	}

	const status: QueueStatus = paused
		? 'paused'
		: stalled
			? 'waiting'
			: 'draining';
	const StatusIcon = status === 'draining' ? ClockIcon : PauseIcon;

	const countLabel = t('workbench:follow-up-queue.aria-label', {
		count: entries.length,
		defaultValue_one: '{{count}} message queued',
		defaultValue_other: '{{count}} messages queued',
	});

	const statusLine = {
		draining: t(
			'workbench:follow-up-queue.status-draining',
			'Sending one at a time as the agent finishes',
		),
		paused: t(
			'workbench:follow-up-queue.status-paused',
			'Paused — nothing sends until you resume',
		),
		waiting: t(
			'workbench:follow-up-queue.status-waiting',
			'Held back — send them yourself when you are ready',
		),
	}[status];

	return (
		<section
			aria-label={countLabel}
			className='mb-1.5 flex flex-col gap-1 overflow-hidden rounded-xl border border-border bg-pane/60 p-1.5'
		>
			<div className='flex h-6 items-center justify-between gap-2 px-1'>
				<span className='flex min-w-0 items-center gap-1.5'>
					<span className='flex w-5 shrink-0 items-center justify-center'>
						<StatusIcon
							className={cn(
								'size-3.5',
								status === 'draining'
									? 'text-muted-foreground'
									: 'text-accent-strong',
							)}
						/>
					</span>
					<span className='shrink-0 font-medium text-xs'>{countLabel}</span>
					<span className='truncate text-muted-foreground text-xxs'>
						{statusLine}
					</span>
				</span>
				<div className='flex shrink-0 items-center gap-1'>
					{stalled ? (
						<Button
							className='rounded-md'
							onClick={onSendNow}
							size='xs'
							type='button'
							variant='outline'
						>
							{paused
								? t('workbench:follow-up-queue.resume', 'Resume')
								: t('workbench:follow-up-queue.send-next', 'Send next')}
						</Button>
					) : null}
					<Button
						className='rounded-md text-muted-foreground'
						onClick={onClear}
						size='xs'
						type='button'
						variant='ghost'
					>
						{t('workbench:follow-up-queue.clear', 'Clear all')}
					</Button>
				</div>
			</div>
			<FollowUpQueueList
				entries={entries}
				onEdit={onEdit}
				onMove={onMove}
				onRemove={onRemove}
				onReorder={onReorder}
				onSteer={onSteer}
				streaming={streaming}
			/>
		</section>
	);
}
