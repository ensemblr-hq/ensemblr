import { cn } from '@/renderer/lib/utils';
import type { PiTimelineSessionMeta } from '@/renderer/types/pi-timeline';

/** Formats a token count compactly: 980, 4.2k, 1.3M. */
function formatTokens(count: number): string {
	if (count < 1000) {
		return String(count);
	}
	if (count < 1_000_000) {
		return `${(count / 1000).toFixed(1)}k`;
	}
	return `${(count / 1_000_000).toFixed(1)}M`;
}

/**
 * Compact session status bar: model, token usage, cost, and context-window
 * usage from `get_session_stats`, plus extension `setStatus` texts. This is
 * where timeline-noise frames surface as numbers — they never become items.
 */
export function PiSessionStatusBar({
	className,
	session,
}: {
	className?: string;
	session: PiTimelineSessionMeta;
}) {
	const { model, stats, statusTexts } = session;
	const tokens = stats?.tokens?.total ?? null;
	const cost = stats?.cost ?? null;
	const contextPercent = stats?.contextUsage?.percent ?? null;
	const statusEntries = Object.entries(statusTexts);
	const segments: string[] = [];
	if (model) {
		segments.push(model);
	}
	if (tokens !== null) {
		segments.push(`${formatTokens(tokens)} tokens`);
	}
	if (cost !== null) {
		segments.push(`$${cost.toFixed(2)}`);
	}
	if (contextPercent !== null && contextPercent !== undefined) {
		segments.push(`${Math.round(contextPercent)}% context`);
	}
	if (segments.length === 0 && statusEntries.length === 0) {
		return null;
	}
	return (
		<div
			className={cn(
				'flex min-w-0 items-center gap-3 border-border/40 border-t px-4 py-1.5 text-muted-foreground/80 text-xs',
				className,
			)}
			data-role='session-status-bar'
		>
			<span className='min-w-0 truncate'>{segments.join(' · ')}</span>
			{statusEntries.length > 0 ? (
				<span className='ml-auto flex min-w-0 shrink gap-3 truncate'>
					{statusEntries.map(([key, text]) => (
						<span className='truncate' key={key}>
							{text}
						</span>
					))}
				</span>
			) : null}
		</div>
	);
}
