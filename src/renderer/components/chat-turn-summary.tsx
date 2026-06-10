import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { cn } from '@/renderer/lib/utils';

import { formatTurnDuration } from './chat-turn-timer';

/**
 * Auto-collapsed summary chip rendered once the assistant turn finalizes. Mirrors
 * the GIF reference where all preceding `Thinking`/`Read`/`Bash` rows fold into
 * one row like `▸  5 tool calls, 3 reasoning  1m`. Clicking expands the chip
 * to reveal the original rows in place.
 */
export function ChatTurnSummary({
	children,
	className,
	defaultOpen = false,
	durationMs,
	messageCount,
	toolCount,
}: {
	children: ReactNode;
	className?: string;
	defaultOpen?: boolean;
	durationMs: number | null;
	messageCount: number;
	toolCount: number;
}) {
	const [open, setOpen] = useState(defaultOpen);
	const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
	const segments: string[] = [];
	if (toolCount > 0) {
		segments.push(`${toolCount} tool ${pluralize('call', toolCount)}`);
	}
	if (messageCount > 0) {
		segments.push(`${messageCount} ${pluralize('message', messageCount)}`);
	}
	if (segments.length === 0) {
		segments.push('Work');
	}
	const headline = segments.join(', ');
	const trailing = durationMs !== null ? formatTurnDuration(durationMs) : null;
	return (
		<div className={cn('flex flex-col gap-2', className)} data-role='turn-summary'>
			<button
				aria-expanded={open}
				className='flex w-fit items-center gap-2 rounded-md px-1 text-muted-foreground text-xs leading-5 transition-colors hover:text-foreground'
				onClick={() => setOpen((current) => !current)}
				type='button'
			>
				<Chevron aria-hidden='true' className='size-3.5' />
				<span>{headline}</span>
				{trailing ? (
					<span className='text-muted-foreground/70'>{trailing}</span>
				) : null}
			</button>
			{open ? (
				<div className='flex flex-col gap-1.5 border-border/40 border-l pl-3'>
					{children}
				</div>
			) : null}
		</div>
	);
}

function pluralize(word: string, count: number): string {
	return count === 1 ? word : `${word}s`;
}
