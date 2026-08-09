import { useTranslation } from 'react-i18next';
import { cn } from '@/renderer/lib/utils';
import type { PiTimelineSessionMeta } from '@/renderer/types/pi-replay';

/**
 * One compact number formatter per language. `Intl.NumberFormat` construction
 * is the expensive half of formatting, and the status bar re-renders on every
 * stats frame, so the instances are held for the life of the module.
 */
const COMPACT_FORMATTERS = new Map<string, Intl.NumberFormat>();

/**
 * Formats a token count in the reader's own abbreviation — `1.2K` in English,
 * `1,2 тыс.` in Russian — which is why the suffix cannot be hard-coded.
 * @param count - Raw token count.
 * @param language - The active i18next language tag.
 * @returns The abbreviated count.
 */
function formatTokens(count: number, language: string): string {
	const cached = COMPACT_FORMATTERS.get(language);
	if (cached) {
		return cached.format(count);
	}
	const formatter = new Intl.NumberFormat(language, {
		maximumFractionDigits: 1,
		notation: 'compact',
	});
	COMPACT_FORMATTERS.set(language, formatter);
	return formatter.format(count);
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
	const { i18n, t } = useTranslation();
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
		segments.push(
			t('common:session-status.tokens', {
				count: tokens,
				defaultValue_one: '{{formatted}} token',
				defaultValue_other: '{{formatted}} tokens',
				formatted: formatTokens(tokens, i18n.language),
			}),
		);
	}
	if (cost !== null) {
		segments.push(`$${cost.toFixed(2)}`);
	}
	if (contextPercent !== null && contextPercent !== undefined) {
		segments.push(
			t('common:session-status.context', '{{percent}}% context', {
				percent: Math.round(contextPercent),
			}),
		);
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
