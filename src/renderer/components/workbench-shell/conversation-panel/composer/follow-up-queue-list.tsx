import {
	GripVerticalIcon,
	PaperclipIcon,
	PencilIcon,
	SendHorizontalIcon,
	XIcon,
} from 'lucide-react';
import { Reorder, useDragControls, useMotionValue } from 'motion/react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { useRaisedShadow } from '@/renderer/hooks/use-raised-shadow';
import { cn } from '@/renderer/lib/utils';
import type { QueuedFollowUp } from '@/renderer/types/workbench';

/** Wiring for one row's drag handle, which doubles as its position marker. */
interface DragHandleProps {
	entryId: string;
	isFirst: boolean;
	isLast: boolean;
	onMove: (id: string, direction: 'down' | 'up') => void;
	onPointerDown: (event: PointerEvent) => void;
	position: number;
}

/** Wiring for one queued message's row. */
interface FollowUpQueueRowProps {
	actions: QueueRowActions;
	entry: QueuedFollowUp;
	isFirst: boolean;
	isLast: boolean;
	onDragEnd: () => void;
	position: number;
}

/** Wiring for the queued-message list. */
interface FollowUpQueueListProps {
	entries: readonly QueuedFollowUp[];
	/** Null while the composer holds a draft an edit would have to clobber. */
	onEdit: ((id: string) => void) | null;
	onMove: (id: string, direction: 'down' | 'up') => void;
	onRemove: (id: string) => void;
	onReorder: (orderedIds: readonly string[]) => void;
	/** Sends one entry out of turn; null while the composer cannot send at all. */
	onSteer: ((id: string) => void) | null;
	/** True while a turn is running, which is what makes the out-of-turn send a steer. */
	streaming: boolean;
}

/** How the rows behave, shared by every row so they cannot drift apart. */
interface QueueRowActions {
	/** Null while the composer holds a draft an edit would have to clobber. */
	onEdit: ((id: string) => void) | null;
	onMove: (id: string, direction: 'down' | 'up') => void;
	onRemove: (id: string) => void;
	/** Null while the composer cannot send at all. */
	onSteer: ((id: string) => void) | null;
	streaming: boolean;
}

/**
 * Grabs the row, and moves it for a keyboard.
 *
 * Dragging is pointer-only, so the handle is a real button that answers the
 * arrow keys too — otherwise reordering would be a mouse-only capability, and
 * the queue is the one part of the composer a keyboard user is most likely to be
 * correcting something in.
 */
function DragHandle({
	entryId,
	isFirst,
	isLast,
	onMove,
	onPointerDown,
	position,
}: DragHandleProps) {
	const { t } = useTranslation();

	const handleKeyDown = (event: KeyboardEvent) => {
		if (event.key === 'ArrowUp' && !isFirst) {
			event.preventDefault();
			onMove(entryId, 'up');
		}
		if (event.key === 'ArrowDown' && !isLast) {
			event.preventDefault();
			onMove(entryId, 'down');
		}
	};

	return (
		<button
			aria-label={t(
				'workbench:follow-up-queue.reorder',
				'Reorder, position {{position}}',
				{
					position,
				},
			)}
			className={cn(
				'group/handle flex h-6 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing',
				isFirst ? 'text-accent-strong' : 'text-muted-foreground',
			)}
			onKeyDown={handleKeyDown}
			onPointerDown={onPointerDown}
			type='button'
		>
			<span className='font-medium text-xxs tabular-nums group-hover/row:hidden group-focus-visible/handle:hidden'>
				{position}
			</span>
			<GripVerticalIcon className='hidden size-3.5 group-hover/row:block group-focus-visible/handle:block' />
		</button>
	);
}

/**
 * One icon action on a queued row. Wrapped in a span so the tooltip still fires
 * over a disabled button, which is the whole point of the blocked variants —
 * they have to say why they cannot be used.
 *
 * One label serves the tooltip and the accessible name, so a blocked action
 * cannot show its reason to a pointer and read as available to a screen reader.
 * The caller resolves which label applies before passing it.
 */
function QueueRowAction({
	children,
	label,
	onClick,
}: {
	children: ReactNode;
	label: string;
	/** Null renders the action disabled; `label` then carries the reason. */
	onClick: (() => void) | null;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span>
					<Button
						aria-label={label}
						className='rounded-md text-muted-foreground hover:text-foreground'
						disabled={onClick === null}
						onClick={() => onClick?.()}
						size='icon-xs'
						type='button'
						variant='ghost'
					>
						{children}
					</Button>
				</span>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

/**
 * One queued message: a handle that says where it sits, what it says, and the
 * three things that can be done to it. The head reads in the accent colour and
 * is labelled as next, because the order rows sit in is the order they send and
 * nothing else on the row says which one the agent gets first.
 *
 * A chore keeps the same shape but reads muted, because it was queued by the
 * Checks panel rather than typed here and will drain on its own under every
 * Follow-up behavior.
 */
function FollowUpQueueRow({
	actions,
	entry,
	isFirst,
	isLast,
	onDragEnd,
	position,
}: FollowUpQueueRowProps) {
	const { t } = useTranslation();
	const y = useMotionValue(0);
	const boxShadow = useRaisedShadow(y);
	const dragControls = useDragControls();
	const attachmentCount = entry.segments.filter(
		(segment) => segment.kind === 'attachment',
	).length;
	const steerLabel =
		actions.onSteer === null
			? t(
					'workbench:follow-up-queue.steer-blocked',
					'The agent cannot take a message right now',
				)
			: actions.streaming
				? t('workbench:follow-up-queue.steer', 'Steer the agent with this now')
				: t('workbench:follow-up-queue.send-immediately', 'Send this now');
	const editLabel =
		actions.onEdit === null
			? t(
					'workbench:follow-up-queue.edit-blocked',
					'Send or clear the current draft first',
				)
			: t('workbench:follow-up-queue.edit', 'Edit in composer');

	return (
		<Reorder.Item
			className={cn(
				'group/row flex list-none items-center gap-1.5 rounded-md border px-1 py-1 transition-colors',
				isFirst
					? 'border-accent-strong/25 bg-accent-strong/5'
					: 'border-transparent hover:border-border/60 hover:bg-secondary/50',
			)}
			dragControls={dragControls}
			dragListener={false}
			id={entry.id}
			layout='position'
			onDragEnd={onDragEnd}
			style={{ boxShadow, y }}
			value={entry.id}
		>
			<DragHandle
				entryId={entry.id}
				isFirst={isFirst}
				isLast={isLast}
				onMove={actions.onMove}
				onPointerDown={(event) => dragControls.start(event)}
				position={position}
			/>
			<div className='flex min-w-0 flex-1 flex-col gap-1'>
				<p
					className={cn(
						'line-clamp-2 break-words text-xs leading-snug',
						entry.source === 'chore'
							? 'text-muted-foreground italic'
							: 'text-foreground',
					)}
				>
					{entry.text.trim()}
				</p>
				{isFirst || attachmentCount > 0 ? (
					<span className='flex items-center gap-2 text-xxs leading-none'>
						{isFirst ? (
							<span className='font-medium text-accent-strong uppercase tracking-wide'>
								{t('workbench:follow-up-queue.next', 'Next')}
							</span>
						) : null}
						{attachmentCount > 0 ? (
							<span className='inline-flex items-center gap-1 text-muted-foreground'>
								<PaperclipIcon className='size-3' />
								{t('workbench:follow-up-queue.attachments', {
									count: attachmentCount,
									defaultValue_one: '{{count}} attachment',
									defaultValue_other: '{{count}} attachments',
								})}
							</span>
						) : null}
					</span>
				) : null}
			</div>
			<div className='flex shrink-0 items-center gap-0.5'>
				<QueueRowAction
					label={steerLabel}
					onClick={
						actions.onSteer === null ? null : () => actions.onSteer?.(entry.id)
					}
				>
					<SendHorizontalIcon className='size-3' />
				</QueueRowAction>
				<QueueRowAction
					label={editLabel}
					onClick={
						actions.onEdit === null ? null : () => actions.onEdit?.(entry.id)
					}
				>
					<PencilIcon className='size-3' />
				</QueueRowAction>
				<QueueRowAction
					label={t('workbench:follow-up-queue.remove', 'Remove from queue')}
					onClick={() => actions.onRemove(entry.id)}
				>
					<XIcon className='size-3' />
				</QueueRowAction>
			</div>
		</Reorder.Item>
	);
}

/**
 * The queued messages, in the order they will be sent, reorderable by dragging a
 * row's handle.
 *
 * Split out of the stack around it so the same list can be rendered on its own,
 * which is how the playground shows it at every queue depth without standing up
 * a composer to hold it.
 *
 * Scrolls natively under `sleek-scrollbar` rather than through Radix
 * `ScrollArea`, so the box hugs however tall the rows actually came out. Rows
 * vary — one line, two clamped lines, and a head that carries a meta line — so
 * the definite height an overlay viewport needs could only ever be an average,
 * and it left short queues sitting in dead space.
 */
export function FollowUpQueueList({
	entries,
	onEdit,
	onMove,
	onRemove,
	onReorder,
	onSteer,
	streaming,
}: FollowUpQueueListProps) {
	// Motion settles a dropped row into its slot, so the dragged order has to hold
	// until release; committing per crossing yanks the row out from under the cursor.
	const [dragging, setDragging] = useState<readonly string[] | null>(null);
	const committedIds = entries.map((entry) => entry.id);
	const orderedIds = dragging ?? committedIds;
	const byId = new Map(entries.map((entry) => [entry.id, entry] as const));
	const actions: QueueRowActions = {
		onEdit,
		onMove,
		onRemove,
		onSteer,
		streaming,
	};

	const commitDrag = () => {
		if (dragging) {
			onReorder(dragging);
			setDragging(null);
		}
	};

	return (
		<div className='sleek-scrollbar max-h-44 overflow-y-auto overscroll-contain'>
			<Reorder.Group
				axis='y'
				className='m-0! flex list-none flex-col gap-0.5 p-0!'
				onReorder={(next: string[]) => setDragging(next)}
				values={orderedIds as string[]}
			>
				{orderedIds.map((id, index) => {
					const entry = byId.get(id);
					return entry ? (
						<FollowUpQueueRow
							actions={actions}
							entry={entry}
							isFirst={index === 0}
							isLast={index === orderedIds.length - 1}
							key={id}
							onDragEnd={commitDrag}
							position={index + 1}
						/>
					) : null;
				})}
			</Reorder.Group>
		</div>
	);
}
