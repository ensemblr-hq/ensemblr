import type { TFunction } from 'i18next';
import { ClockIcon, PauseIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';
import type {
	FollowUpQueueHoldReason,
	QueuedFollowUp,
} from '@/renderer/types/workbench';
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
	/**
	 * Resumes a paused queue, sending the head straight away when the agent is
	 * idle. Null renders the control disabled, for a composer that cannot take a
	 * send at all: it would refuse the entry, and a run of refusals pauses the
	 * queue under a reason no error on screen accounts for.
	 */
	onSendNow: (() => void) | null;
	/** Sends one entry out of turn; null while the composer cannot send at all. */
	onSteer: ((id: string) => void) | null;
	/** Why the head will not go on its own — a stop, or a failed send — or null while it will. */
	pauseReason: FollowUpQueueHoldReason | null;
	/** True while the queue waits on the user rather than on the agent. */
	stalled: boolean;
	streaming: boolean;
}

/**
 * Why the queue is sitting still, which is the one thing the old chip could not
 * say without being opened. `draining` goes on its own when the turn ends;
 * `paused` was stopped and stays stopped, for whichever of the two reasons
 * {@link FollowUpQueueHoldReason} carries; `waiting` is the `block` behavior
 * holding a message the user has to release by hand.
 */
type QueueStatus = 'draining' | 'paused' | 'waiting';

/**
 * What the strip says about itself. A pause names which pause it was: the two
 * look identical on screen, so the wording is the only thing that tells a queue
 * the user stopped from one whose session would not take the message, and a
 * pause a user cannot account for is what made this read as arbitrary.
 *
 * The stop line names the stop and nothing further. A pause is scoped to the
 * messages it parked rather than to the queue, so the rows on screen can be a
 * stopped message with newer ones queued behind it; a line saying what the pause
 * is *about* would be false of half that list, and the strip has no room to name
 * which rows it means.
 *
 * Switched rather than chained so a reason added to
 * {@link FollowUpQueueHoldReason} is a compile error here rather than a paused
 * queue quietly rendering the draining line.
 * @param pauseReason - Which pause it was, or null while the queue is not paused
 * @param stalled - Whether an unpaused queue is waiting on the user
 * @param t - The translator for the surrounding render
 * @returns The status line to show beside the count
 */
function queueStatusLine(
	pauseReason: FollowUpQueueHoldReason | null,
	stalled: boolean,
	t: TFunction,
): string {
	switch (pauseReason) {
		case 'turn-stopped':
			return t(
				'workbench:follow-up-queue.status-paused-stopped',
				'Paused — you stopped the turn',
			);
		case 'send-failed':
			return t(
				'workbench:follow-up-queue.status-paused-failed',
				'Paused — the last message could not be sent',
			);
		case null:
			return stalled
				? t(
						'workbench:follow-up-queue.status-waiting',
						'Held back — send them yourself when you are ready',
					)
				: t(
						'workbench:follow-up-queue.status-draining',
						'Sending one at a time as the agent finishes',
					);
		default: {
			const unhandled: never = pauseReason;
			return unhandled;
		}
	}
}

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
	pauseReason,
	stalled,
	streaming,
}: FollowUpQueueStackProps) {
	const { t } = useTranslation();

	if (entries.length === 0) {
		return null;
	}

	const status: QueueStatus = pauseReason
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

	const statusLine = queueStatusLine(pauseReason, stalled, t);

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
							disabled={onSendNow === null}
							onClick={() => onSendNow?.()}
							size='xs'
							type='button'
							variant='outline'
						>
							{pauseReason
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
