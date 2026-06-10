import { useEffect, useState } from 'react';
import { cn } from '@/renderer/lib/utils';
import type { PiThinkingItem } from '@/renderer/types/pi-timeline';

/**
 * Single muted row for one reasoning block. Captures carry no reasoning text
 * (pi emits thinking_start/thinking_end with only an encrypted signature —
 * see docs/pi/event-taxonomy.md), so the row is duration-only: a live ticking
 * "Reasoning…" while open, "Reasoned for Ns" once closed.
 */
export function PiThinkingRow({
	className,
	item,
}: {
	className?: string;
	item: PiThinkingItem;
}) {
	const isOpen = item.endedAtMs === null;
	const [nowMs, setNowMs] = useState(() => Date.now());
	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const id = window.setInterval(() => setNowMs(Date.now()), 250);
		return () => window.clearInterval(id);
	}, [isOpen]);

	const durationMs = (item.endedAtMs ?? nowMs) - item.startedAtMs;
	const seconds = Math.max(0, durationMs) / 1000;
	const label = isOpen
		? `Reasoning… ${seconds.toFixed(1)}s`
		: `Reasoned for ${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;

	return (
		<div
			className={cn(
				'flex items-center gap-2 text-muted-foreground/80 text-xs italic',
				className,
			)}
			data-kind='thinking'
			data-role='timeline-item'
		>
			<span className={cn(isOpen && 'animate-pulse')}>{label}</span>
		</div>
	);
}
