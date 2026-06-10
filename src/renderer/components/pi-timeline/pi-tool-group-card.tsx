import {
	ChevronDownIcon,
	ChevronRightIcon,
	WrenchIcon,
	XIcon,
} from 'lucide-react';
import { useState } from 'react';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@/renderer/components/ui/collapsible';
import { Spinner } from '@/renderer/components/ui/spinner';
import { cn } from '@/renderer/lib/utils';
import type { PiToolGroupItem } from '@/renderer/types/pi-timeline';

import { PiToolCard } from './pi-tool-card.tsx';

/**
 * Collapsed summary for consecutive tool calls ("4 tool calls · 3.2s"),
 * expandable into the individual cards. Shows a spinner while any member is
 * still running and a red x when any member failed.
 */
export function PiToolGroupCard({
	className,
	group,
}: {
	className?: string;
	group: PiToolGroupItem;
}) {
	const [open, setOpen] = useState(false);
	const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
	const running = group.calls.some((call) => call.endedAtMs === null);
	const failed = group.calls.some((call) => call.status === 'error');
	const first = group.calls[0];
	const lastEnd = group.calls.reduce<number | null>(
		(latest, call) =>
			call.endedAtMs === null
				? latest
				: Math.max(latest ?? call.endedAtMs, call.endedAtMs),
		null,
	);
	const spanMs =
		first && lastEnd !== null ? Math.max(0, lastEnd - first.startedAtMs) : null;

	return (
		<Collapsible
			className={cn('w-full', className)}
			data-kind='tool-group'
			data-role='timeline-item'
			onOpenChange={setOpen}
			open={open}
		>
			<CollapsibleTrigger className='group flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-[0.8125rem] leading-5 transition-colors hover:bg-secondary/50'>
				<Chevron
					aria-hidden='true'
					className='size-3.5 shrink-0 text-muted-foreground/60'
				/>
				{running ? (
					<Spinner className='size-3.5 shrink-0 text-muted-foreground' />
				) : failed ? (
					<XIcon
						aria-hidden='true'
						className='size-3.5 shrink-0 text-status-danger'
					/>
				) : (
					<WrenchIcon
						aria-hidden='true'
						className='size-3.5 shrink-0 text-muted-foreground/70'
					/>
				)}
				<span className='font-medium text-foreground/85'>
					{group.calls.length} tool calls
				</span>
				{spanMs !== null ? (
					<span className='text-muted-foreground/60 text-xs'>
						· {(spanMs / 1000).toFixed(1)}s
					</span>
				) : null}
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div className='flex flex-col gap-1 border-border/40 border-l py-1 pl-3'>
					{group.calls.map((call) => (
						<PiToolCard call={call} key={call.id} />
					))}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}
