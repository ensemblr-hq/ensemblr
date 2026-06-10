import type { DynamicToolUIPart } from 'ai';
import type { ReactNode } from 'react';
import { chipLabelForPath, projectToolRow } from '@/renderer/lib/pi';
import { cn } from '@/renderer/lib/utils';

import { ChatAttachmentChip } from './chat-attachment-chip';

/**
 * Single-line compact activity row used during streaming. Matches the GIF
 * reference where each step (Thinking, Read, Bash, ...) is one row:
 * `[label]  [detail or chip]`.
 *
 * Multiple rows stack vertically below the user prompt while the assistant is
 * still producing text/tool calls. Once a final response arrives, the parent
 * collapses the whole group into a single summary chip.
 */
export function ChatActivityRow({
	chip,
	className,
	detail,
	label,
}: {
	chip?: ReactNode;
	className?: string;
	detail?: ReactNode;
	label: string;
}) {
	return (
		<div
			className={cn(
				'flex min-w-0 items-center gap-2.5 text-[0.8125rem] leading-5',
				className,
			)}
			data-role='activity-row'
		>
			<span className='shrink-0 font-medium text-foreground/85'>{label}</span>
			{detail !== undefined && detail !== null && detail !== '' ? (
				<span className='min-w-0 truncate font-mono text-muted-foreground text-xs'>
					{detail}
				</span>
			) : null}
			{chip ? <span className='shrink-0'>{chip}</span> : null}
		</div>
	);
}

/** Italic single-line reasoning row, mirrors the `Thinking <text>` GIF style. */
export function ChatReasoningRow({
	className,
	text,
}: {
	className?: string;
	text: string;
}) {
	const firstLine = text.split('\n').find((line) => line.trim().length > 0);
	const display = firstLine?.trim() ?? '';
	if (display.length === 0) {
		return null;
	}
	return (
		<div
			className={cn(
				'flex min-w-0 items-baseline gap-2.5 text-[0.8125rem] leading-5',
				className,
			)}
			data-role='activity-row'
			data-kind='reasoning'
		>
			<span className='shrink-0 font-medium text-foreground/85'>Thinking</span>
			<span className='min-w-0 truncate text-muted-foreground italic'>
				{display}
			</span>
		</div>
	);
}

/** Renders one tool activity row given the projected mapping. */
export function ChatToolRow({
	className,
	part,
}: {
	className?: string;
	part: DynamicToolUIPart;
}) {
	const projection = projectToolRow(part);
	const chip =
		projection.chipLabel !== null ? (
			<ChatAttachmentChip
				kind='file'
				label={chipLabelForPath(projection.chipLabel)}
			/>
		) : null;
	return (
		<ChatActivityRow
			chip={chip}
			className={className}
			detail={projection.detail}
			label={projection.label}
		/>
	);
}
