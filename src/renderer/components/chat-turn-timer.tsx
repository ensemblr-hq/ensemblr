import { useEffect, useState } from 'react';
import { formatTurnDuration } from '@/renderer/lib/format-duration';
import { cn } from '@/renderer/lib/utils';

/**
 * Live-ticking timer for the currently streaming assistant turn. Matches the
 * GIF reference where a small muted `4.1s` / `1m` label sits below the in-
 * flight activity rows. Once the turn finalizes, the parent stops mounting
 * the live component and renders the frozen `formatTurnDuration(endMs - startMs)`
 * inside the collapsed summary chip instead.
 */
function ChatTurnTimer({
	className,
	startMs,
}: {
	className?: string;
	startMs: number;
}) {
	const [nowMs, setNowMs] = useState(() => Date.now());
	useEffect(() => {
		const id = window.setInterval(() => setNowMs(Date.now()), 100);
		return () => window.clearInterval(id);
	}, []);
	return (
		<span
			className={cn('text-muted-foreground/80 text-xs', className)}
			data-role='turn-timer'
		>
			{formatTurnDuration(Math.max(0, nowMs - startMs))}
		</span>
	);
}

/**
 * Live "working" affordance for an in-flight turn: a pulsing dot, a muted
 * `Working…` label, and the ticking {@link ChatTurnTimer}. Used both for the
 * pre-first-token placeholder and the streaming assistant turn so the row looks
 * identical and the elapsed value stays continuous across the handoff. Anchored
 * at `startMs` (the prompt submit time), bottom-left like the settled footer.
 */
export function ChatWorkingIndicator({
	className,
	startMs,
}: {
	className?: string;
	startMs: number;
}) {
	return (
		<div
			className={cn(
				'flex items-center gap-2 text-muted-foreground/80 text-xs',
				className,
			)}
			data-role='turn-working'
		>
			<span
				aria-hidden='true'
				className='size-1.5 animate-pulse rounded-full bg-muted-foreground/70'
			/>
			<span>Working…</span>
			<ChatTurnTimer startMs={startMs} />
		</div>
	);
}
