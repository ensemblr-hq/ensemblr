import { useEffect, useState } from 'react';
import { CopyResponseButton } from '@/renderer/components/copy-response-button';
import { cn } from '@/renderer/lib/utils';
import type { PiTurnFooterItem } from '@/renderer/types/pi-timeline';

/** Formats a settled turn duration: `12.4s` under a minute, `1m 12s` past. */
function formatFooterDuration(ms: number): string {
	const seconds = ms / 1000;
	if (seconds < 60) {
		return `${seconds.toFixed(1)}s`;
	}
	const minutes = Math.floor(seconds / 60);
	const rest = Math.round(seconds - minutes * 60);
	return `${minutes}m ${rest}s`;
}

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
			<span>{formatFooterDuration(item.durationMs)}</span>
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
			{formatFooterDuration(Math.max(0, nowMs - startedAtMs))}
		</div>
	);
}
