import { useEffect, useState } from 'react';
import { cn } from '@/renderer/lib/utils';

/**
 * Live-ticking timer for the currently streaming assistant turn. Matches the
 * GIF reference where a small muted `4.1s` / `1m` label sits below the in-
 * flight activity rows. Once the turn finalizes, the parent stops mounting
 * the live component and renders the frozen `formatTurnDuration(endMs - startMs)`
 * inside the collapsed summary chip instead.
 */
export function ChatTurnTimer({
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
 * Compact duration formatter mirroring the reference. Under 10s shows one
 * decimal (`1.8s`), 10s-59s shows integer seconds (`14s`), 60s+ rounds to
 * whole minutes (`1m`).
 */
export function formatTurnDuration(ms: number): string {
	const seconds = ms / 1000;
	if (seconds < 10) {
		return `${seconds.toFixed(1)}s`;
	}
	if (seconds < 60) {
		return `${Math.floor(seconds)}s`;
	}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `${minutes}m`;
	}
	const hours = Math.floor(minutes / 60);
	return `${hours}h`;
}
