import {
	GripVerticalIcon,
	PaperclipIcon,
	PencilIcon,
	XIcon,
} from 'lucide-react';
import { Reorder, useDragControls, useMotionValue } from 'motion/react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { useRaisedShadow } from '@/renderer/hooks/use-raised-shadow';
import { cn } from '@/renderer/lib/utils';
import type { QueuedFollowUp } from '@/renderer/types/workbench';
import { getQueueHeight } from './follow-up-queue-height';

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
}

/** How the rows behave, shared by every row so they cannot drift apart. */
interface QueueRowActions {
	/** Null while the composer holds a draft an edit would have to clobber. */
	onEdit: ((id: string) => void) | null;
	onMove: (id: string, direction: 'down' | 'up') => void;
	onRemove: (id: string) => void;
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
			className='group/handle -ml-0.5 flex h-6 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing'
			onKeyDown={handleKeyDown}
			onPointerDown={onPointerDown}
			type='button'
		>
			<span className='text-xxs tabular-nums group-hover/row:hidden group-focus-visible/handle:hidden'>
				{position}
			</span>
			<GripVerticalIcon className='hidden size-3.5 group-hover/row:block group-focus-visible/handle:block' />
		</button>
	);
}

/**
 * One queued message: a handle that says where it sits, what it says, and the
 * two things that can be done to it. A chore keeps the same shape but reads
 * muted, because it was queued by the Checks panel rather than typed here and
 * will drain on its own under every Follow-up behavior.
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

	return (
		<Reorder.Item
			className='group/row flex list-none items-start gap-1.5 rounded-md border border-transparent bg-popover px-1 py-1.5 hover:border-border/60 hover:bg-secondary/50'
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
			<div className='flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5'>
				<p
					className={cn(
						'line-clamp-2 text-xs leading-snug',
						entry.source === 'chore'
							? 'text-muted-foreground italic'
							: 'text-foreground',
					)}
				>
					{entry.text.trim()}
				</p>
				{attachmentCount > 0 ? (
					<span className='inline-flex items-center gap-1 text-muted-foreground text-xxs'>
						<PaperclipIcon className='size-3' />
						{t('workbench:follow-up-queue.attachments', {
							count: attachmentCount,
							defaultValue_one: '{{count}} attachment',
							defaultValue_other: '{{count}} attachments',
						})}
					</span>
				) : null}
			</div>
			<div className='flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100'>
				<EditButton entryId={entry.id} onEdit={actions.onEdit} />
				<Button
					aria-label={t(
						'workbench:follow-up-queue.remove',
						'Remove from queue',
					)}
					className='size-6 rounded-md'
					onClick={() => actions.onRemove(entry.id)}
					size='icon-sm'
					type='button'
					variant='ghost'
				>
					<XIcon className='size-3' />
				</Button>
			</div>
		</Reorder.Item>
	);
}

/**
 * Puts a queued message back in the composer. Disabled rather than degraded when
 * a draft is already there: editing restores the message's chips where the user
 * put them, and appending it as plain text instead would quietly drop them.
 */
function EditButton({
	entryId,
	onEdit,
}: {
	entryId: string;
	onEdit: ((id: string) => void) | null;
}) {
	const { t } = useTranslation();

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span>
					<Button
						aria-label={t('workbench:follow-up-queue.edit', 'Edit in composer')}
						className='size-6 rounded-md'
						disabled={onEdit === null}
						onClick={() => onEdit?.(entryId)}
						size='icon-sm'
						type='button'
						variant='ghost'
					>
						<PencilIcon className='size-3' />
					</Button>
				</span>
			</TooltipTrigger>
			<TooltipContent>
				{onEdit === null
					? t(
							'workbench:follow-up-queue.edit-blocked',
							'Send or clear the current draft first',
						)
					: t('workbench:follow-up-queue.edit', 'Edit in composer')}
			</TooltipContent>
		</Tooltip>
	);
}

/**
 * The queued messages, in the order they will be sent, reorderable by dragging a
 * row's handle.
 *
 * Split out of the popover so the same list can be rendered open — a Radix
 * popover cannot be pinned open, which is the only way the playground can show
 * this at every queue depth.
 */
export function FollowUpQueueList({
	entries,
	onEdit,
	onMove,
	onRemove,
	onReorder,
}: FollowUpQueueListProps) {
	// Motion settles a dropped row into its slot, so the dragged order has to hold
	// until release; committing per crossing yanks the row out from under the cursor.
	const [dragging, setDragging] = useState<readonly string[] | null>(null);
	const committedIds = entries.map((entry) => entry.id);
	const orderedIds = dragging ?? committedIds;
	const byId = new Map(entries.map((entry) => [entry.id, entry] as const));
	const scrollAreaStyle: CSSProperties = {
		height: getQueueHeight(entries.length),
	};
	const actions: QueueRowActions = { onEdit, onMove, onRemove };

	const commitDrag = () => {
		if (dragging) {
			onReorder(dragging);
			setDragging(null);
		}
	};

	return (
		<ScrollArea className='pr-3.5' style={scrollAreaStyle}>
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
		</ScrollArea>
	);
}
