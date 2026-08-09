import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from '@/renderer/components/ui/hover-card';
import { Progress } from '@/renderer/components/ui/progress';
import type { ComposerContextUsage } from '@/renderer/types/workbench';

/** Stands in for both halves of the count when no window is known. */
const UNKNOWN_TOKENS = '—';

/** Formats token counts into compact model-picker-friendly labels. */
function formatTokens(value: number): string {
	if (value >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(1)}M`;
	}
	if (value >= 1_000) {
		return `${(value / 1_000).toFixed(1)}k`;
	}
	return String(value);
}

/** Renders the composer context-window gauge and hover details. */
export function ContextIndicator({
	usage,
}: {
	usage: ComposerContextUsage | null;
}) {
	const { t } = useTranslation();
	const used = usage?.usedTokens ?? 0;
	const max = usage?.maxTokens ?? 0;
	const percent = max > 0 ? Math.min(100, (used / max) * 100) : 0;
	const hasRingProgress = percent > 0;
	const ringDash = `${percent}, 100`;
	const counts = usage
		? `${formatTokens(used)}/${formatTokens(max)}`
		: `${UNKNOWN_TOKENS}/${UNKNOWN_TOKENS}`;

	return (
		<HoverCard closeDelay={80} openDelay={150}>
			<HoverCardTrigger asChild>
				<Button
					aria-label={t('workbench:context-usage.aria-label', 'Context usage')}
					className='rounded-md'
					size='icon-sm'
					type='button'
					variant='subtle'
				>
					<svg
						aria-hidden='true'
						className='size-4'
						role='img'
						viewBox='0 0 36 36'
					>
						<title>
							{t('workbench:context-usage.gauge-title', 'Context usage gauge')}
						</title>
						<circle
							cx='18'
							cy='18'
							fill='none'
							r='15.9155'
							stroke='currentColor'
							strokeOpacity='0.2'
							strokeWidth='3'
						/>
						{hasRingProgress ? (
							<circle
								cx='18'
								cy='18'
								fill='none'
								pathLength='100'
								r='15.9155'
								stroke='currentColor'
								strokeDasharray={ringDash}
								strokeDashoffset='0'
								strokeLinecap='round'
								strokeWidth='3'
								transform='rotate(-90 18 18)'
							/>
						) : null}
					</svg>
				</Button>
			</HoverCardTrigger>
			<HoverCardContent
				align='end'
				className='flex w-80 flex-col gap-2.5 p-4'
				sideOffset={4}
			>
				<div className='flex items-center justify-between gap-6'>
					<span className='font-medium text-sm'>
						{t('workbench:context-usage.heading', 'Context')}
					</span>
					<span className='text-muted-foreground text-xs tabular-nums'>
						{counts}
					</span>
				</div>
				{usage ? (
					<>
						<Progress className='h-2 bg-muted' value={percent} />
						<div className='flex items-center justify-between gap-6 text-muted-foreground text-xs'>
							<span>
								{t('workbench:context-usage.window-used', 'Window used')}
							</span>
							<span className='tabular-nums'>{percent.toFixed(1)}%</span>
						</div>
					</>
				) : (
					<p className='text-muted-foreground text-xs'>
						{t(
							'workbench:context-usage.unavailable',
							'Context window unavailable for this model.',
						)}
					</p>
				)}
			</HoverCardContent>
		</HoverCard>
	);
}
