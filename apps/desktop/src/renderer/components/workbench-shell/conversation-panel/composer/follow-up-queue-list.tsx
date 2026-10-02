import {
	GripVerticalIcon,
	PencilIcon,
	SendHorizontalIcon,
	XIcon,
} from 'lucide-react';
import { Reorder, useDragControls, useMotionValue } from 'motion/react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { useRaisedShadow } from '@/renderer/hooks/use-raised-shadow';
import { useResizingWidth } from '@/renderer/hooks/workbench-shell/composer/use-resizing-width';
import { cn } from '@/renderer/lib/utils';
import type {
	ComposerDraftSegment,
	QueuedFollowUp,
	QueuedFollowUpSource,
} from '@/renderer/types/workbench';

import { AttachmentIcon } from './attachment-chip';

/**
 * The column a row's position sits in, shared by the drag handle and the static
 * marker that stands in for it. A queue crosses depth 1 on every drain, so the
 * two swap in place constantly and any drift between them reads as the row
 * jumping rather than as the handle going away.
 */
const POSITION_SLOT =
	'flex h-6 w-5 shrink-0 items-center justify-center font-medium text-xxs tabular-nums';

/**
 * Puts a row in its reflowed place outright instead of sliding it there. Motion
 * reads this off the row as its layout transition, and a zero duration is how it
 * spells "no layout animation" while still measuring the box, which is what
 * `Reorder.Group` needs to keep tracking where each row sits.
 */
const INSTANT_LAYOUT_TRANSITION = { layout: { duration: 0 } };

/**
 * Pairs each run of a queued draft with a key. A text run has nothing to be
 * identified by and the same chip can be mentioned twice, so where a run sits is
 * the only stable handle there is — and a queued entry never reorders its own
 * runs, only its place in the list.
 * @param segments - The queued draft, in document order
 * @returns The same runs, each with a key unique among its siblings
 */
function keyDraftSegments(
	segments: readonly ComposerDraftSegment[],
): readonly { key: string; segment: ComposerDraftSegment }[] {
	return segments.map((segment, index) => ({ key: `${index}`, segment }));
}

/**
 * The queued draft as it was written, with each chip standing where the user put
 * it.
 *
 * The entry's flat `text` drops every chip to a single space — that space is
 * there to keep caret offsets addressable, not to be read — so a message whose
 * subject is the file it mentions comes back as a sentence missing its subject:
 * `@timeline.tsx is fixed?` reads as `is fixed?`, which says nothing about what
 * is being asked. Walking the runs instead keeps the chip in the clause it
 * belongs to, so the row reads as the message the user typed.
 *
 * Whitespace is the user's own: unlike a sent prompt, whose runs have been
 * trimmed by serialization, a queued draft still holds the spaces typed either
 * side of a chip, so there is no gap to reconstruct.
 *
 * The chip is filled rather than outlined and pinned to exactly one line box,
 * read off the prose's own leading with `1lh` so it tracks a change to it. A
 * chip is a flex box rather than a run of text, so left to its own size and
 * baseline it makes the line it lands on taller than the line above — which
 * reads as the two clamped lines of one row drifting apart from every other
 * row's. The same trick the timeline plays on a sent prompt.
 */
function QueuedDraftPreview({
	segments,
	source,
}: {
	segments: readonly ComposerDraftSegment[];
	source: QueuedFollowUpSource;
}) {
	return (
		<p
			className={cn(
				'line-clamp-2 break-words text-xs leading-snug',
				source === 'chore' ? 'text-muted-foreground italic' : 'text-foreground',
			)}
		>
			{keyDraftSegments(segments).map(({ key, segment }) =>
				segment.kind === 'text' ? (
					<span key={key}>{segment.text}</span>
				) : (
					<span
						className='mx-px inline-flex h-[1lh] max-w-40 items-center gap-1 rounded-sm bg-muted px-1 align-top font-medium text-foreground text-xxs not-italic'
						key={key}
						title={segment.attachment.label}
					>
						<AttachmentIcon attachment={segment.attachment} />
						<span className='truncate'>{segment.attachment.label}</span>
					</span>
				),
			)}
		</p>
	);
}

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
	/** True while the list is mid-resize, which reflows rows rather than animating them. */
	instantLayout: boolean;
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
				'group/handle cursor-grab touch-none rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing',
				POSITION_SLOT,
				isFirst ? 'text-accent-strong' : 'text-muted-foreground',
			)}
			onKeyDown={handleKeyDown}
			onPointerDown={onPointerDown}
			type='button'
		>
			<span className='group-hover/row:hidden group-focus-visible/handle:hidden'>
				{position}
			</span>
			<GripVerticalIcon className='hidden size-3.5 group-hover/row:block group-focus-visible/handle:block' />
		</button>
	);
}

/**
 * Where a row sits, for a queue that cannot be reordered.
 *
 * A lone entry has nowhere to move to, so it keeps the position number but
 * neither the grip on hover nor a control that answers the arrow keys — a handle
 * that reorders nothing reads as an action the row does not have.
 */
function QueuePositionMarker({
	isFirst,
	position,
}: {
	isFirst: boolean;
	position: number;
}) {
	return (
		<span
			aria-hidden='true'
			className={cn(
				POSITION_SLOT,
				isFirst ? 'text-accent-strong' : 'text-muted-foreground',
			)}
		>
			{position}
		</span>
	);
}

/**
 * Keeps a row's focus on the row when its drag handle is taken away.
 *
 * A queue draining to its last entry swaps that handle for a static marker,
 * which unmounts the button a keyboard user may be standing on and drops focus
 * to the document body — the tab order then restarts from the top of the app.
 * Nothing else restores it, so the row catches the focus itself and holds the
 * user on the message they were already reading.
 *
 * The row's action buttons survive the swap and keep their own focus, which is
 * what the containment check reads: focus still inside the row never moved.
 * @param reorderable - Whether the row still renders a drag handle
 * @returns The row ref to attach, and the handlers that track focus ownership
 */
function useRetainedRowFocus(reorderable: boolean) {
	const rowRef = useRef<HTMLLIElement>(null);
	const heldFocus = useRef(false);

	useLayoutEffect(() => {
		const row = rowRef.current;
		if (reorderable || !heldFocus.current || !row) {
			return;
		}
		if (row.contains(document.activeElement)) {
			return;
		}
		row.focus();
	}, [reorderable]);

	return {
		onBlur: () => {
			heldFocus.current = false;
		},
		onFocus: () => {
			heldFocus.current = true;
		},
		rowRef,
	};
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
 * three things that can be done to it.
 *
 * The head is marked by colour and position alone — accent border, accent tint,
 * accent position number, top of the list. A fifth signal spelling it out took a
 * line of its own on that row only, which is what made the stack read ragged, so
 * the word survives as screen-reader text. The drag handle already announces
 * which place a row holds, so that leaves the tint and the border silent rather
 * than the whole set.
 *
 * A chore keeps the same shape but reads muted, because it was queued by the
 * Checks panel rather than typed here and will drain on its own under every
 * Follow-up behavior.
 */
function FollowUpQueueRow({
	actions,
	entry,
	instantLayout,
	isFirst,
	isLast,
	onDragEnd,
	position,
}: FollowUpQueueRowProps) {
	const { t } = useTranslation();
	const y = useMotionValue(0);
	const boxShadow = useRaisedShadow(y);
	const dragControls = useDragControls();
	const reorderable = !(isFirst && isLast);
	const { onBlur, onFocus, rowRef } = useRetainedRowFocus(reorderable);
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
				'group/row flex list-none items-center gap-1.5 rounded-md border px-1 py-1 transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
				isFirst
					? 'border-accent-strong/25 bg-accent-strong/5'
					: 'border-transparent hover:border-border/60 hover:bg-secondary/50',
			)}
			dragControls={dragControls}
			dragListener={false}
			id={entry.id}
			layout='position'
			onBlur={onBlur}
			onDragEnd={onDragEnd}
			onFocus={onFocus}
			ref={rowRef}
			style={{ boxShadow, y }}
			tabIndex={-1}
			transition={instantLayout ? INSTANT_LAYOUT_TRANSITION : undefined}
			value={entry.id}
		>
			{reorderable ? (
				<DragHandle
					entryId={entry.id}
					isFirst={isFirst}
					isLast={isLast}
					onMove={actions.onMove}
					onPointerDown={(event) => dragControls.start(event)}
					position={position}
				/>
			) : (
				<QueuePositionMarker isFirst={isFirst} position={position} />
			)}
			<div className='flex min-w-0 flex-1 flex-col gap-1'>
				{isFirst ? (
					<span className='sr-only'>
						{t('workbench:follow-up-queue.next', 'Next')}
					</span>
				) : null}
				<QueuedDraftPreview segments={entry.segments} source={entry.source} />
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
 * vary — one line, or two clamped lines, whether or not a chip sits in them — so
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
	const { boxRef, resizing } = useResizingWidth();
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
		<div
			className='sleek-scrollbar max-h-44 overflow-y-auto overscroll-contain'
			ref={boxRef}
		>
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
							instantLayout={resizing}
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
