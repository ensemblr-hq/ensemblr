import { useEffect, useState } from 'react';
import { CopyResponseButton } from '@/renderer/components/copy-response-button';
import { formatTurnDuration } from '@/renderer/lib/format-duration';
import { cn } from '@/renderer/lib/utils';
import type { PiTurnFooterItem } from '@/renderer/types/pi-timeline';

/**
 * Footer rendered at the end of a completed assistant turn: the turn duration
 * (prompt accepted → final event) in small muted text plus an icon-only copy
 * button that grabs the final answer as clean markdown. Aborted turns show a
 * calm "Stopped" marker instead of pretending the answer settled.
 */
export function PiTurnFooter({
	className,
	item,
}: {
	className?: string;
	item: PiTurnFooterItem;
}) {
	return (
		<div
			className={cn(
				'flex items-center gap-1.5 text-muted-foreground/70 text-xs',
				className,
			)}
			data-kind='turn-footer'
			data-role='timeline-item'
		>
			{item.aborted ? (
				<span className='rounded-sm border border-status-warning/40 px-1.5 py-0.5 text-status-warning'>
					Stopped
				</span>
			) : null}
			<span>{formatTurnDuration(item.durationMs)}</span>
			{item.answerText.length > 0 ? (
				<CopyResponseButton text={item.answerText} />
			) : null}
		</div>
	);
}

/**
 * Live footer shown while the turn is still streaming: a ticking timer and no
 * copy button. Swapped for {@link PiTurnFooter} once the turn settles.
 */
export function PiLiveTurnFooter({
	className,
	startedAtMs,
}: {
	className?: string;
	startedAtMs: number;
}) {
	const [nowMs, setNowMs] = useState(() => Date.now());
	useEffect(() => {
		const id = window.setInterval(() => setNowMs(Date.now()), 100);
		return () => window.clearInterval(id);
	}, []);
	return (
		<div
			className={cn('text-muted-foreground/70 text-xs', className)}
			data-kind='turn-footer-live'
			data-role='timeline-item'
		>
			{formatTurnDuration(Math.max(0, nowMs - startedAtMs))}
		</div>
	);
}
