import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from '@/renderer/components/ui/hover-card';
import { Progress } from '@/renderer/components/ui/progress';
import {
	formatSessionCost,
	planStatusLabel,
	planWindowLabel,
	planWindowResetLabel,
} from '@/renderer/lib/plan-limit-text';
import type {
	ComposerContextUsage,
	ComposerPlanUsage,
} from '@/renderer/types/workbench';

/** Stands in for both halves of the count when no window is known. */
const UNKNOWN_TOKENS = '—';

/** Stands in for a plan window the runtime named but reported no reading for. */
const UNKNOWN_UTILIZATION = '—';

/**
 * The plan half of the context card: the runtime's spend verdict when it is
 * anything but plain `allowed`, a bar per reported window, the running session
 * cost, and the note that the cost is an estimate rather than a bill.
 */
function PlanUsageSection({
	cost,
	usage,
}: {
	cost: string | null;
	usage: ComposerPlanUsage;
}) {
	const { t } = useTranslation();
	const verdict = planStatusLabel(usage.status, t);

	return (
		<div className='flex flex-col gap-2.5 border-border border-t pt-2.5'>
			<div className='flex items-center justify-between gap-6'>
				<span className='font-medium text-sm'>
					{t('workbench:plan-usage.heading', 'Plan usage')}
				</span>
				{cost ? (
					<span className='text-muted-foreground text-xs tabular-nums'>
						{cost}
					</span>
				) : null}
			</div>
			{verdict ? (
				<p
					className={
						usage.status === 'rejected'
							? 'text-destructive text-xs'
							: 'text-amber-600 text-xs dark:text-amber-500'
					}
				>
					{verdict}
				</p>
			) : null}
			{usage.limits.map((window) => {
				const resets = planWindowResetLabel(window.resetsAt, t);
				return (
					<div className='flex flex-col gap-1' key={window.id}>
						<div className='flex items-center justify-between gap-6 text-xs'>
							<span>{planWindowLabel(window, t)}</span>
							<span className='text-muted-foreground tabular-nums'>
								{window.utilization === null
									? UNKNOWN_UTILIZATION
									: `${Math.round(window.utilization)}%`}
							</span>
						</div>
						<Progress
							className='h-1.5 bg-muted'
							value={window.utilization ?? 0}
						/>
						{resets ? (
							<span className='text-muted-foreground text-xs'>{resets}</span>
						) : null}
					</div>
				);
			})}
			<p className='text-muted-foreground text-xs'>
				{t(
					'workbench:plan-usage.estimate-note',
					'Cost is this session’s own estimate, not a bill.',
				)}
			</p>
		</div>
	);
}

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

/**
 * Renders the composer context-window gauge, with the chat's plan usage and
 * running cost folded into the same hover card. Both answer "how much room is
 * left", one within the turn and one within the billing window, so they belong
 * behind one control rather than two competing gauges on the same row.
 */
export function ContextIndicator({
	planUsage = null,
	usage,
}: {
	planUsage?: ComposerPlanUsage | null;
	usage: ComposerContextUsage | null;
}) {
	const { i18n, t } = useTranslation();
	const used = usage?.usedTokens ?? 0;
	const max = usage?.maxTokens ?? 0;
	const percent = max > 0 ? Math.min(100, (used / max) * 100) : 0;
	const hasRingProgress = percent > 0;
	const ringDash = `${percent}, 100`;
	const counts = usage
		? `${formatTokens(used)}/${formatTokens(max)}`
		: `${UNKNOWN_TOKENS}/${UNKNOWN_TOKENS}`;
	const cost = formatSessionCost(
		planUsage?.totalCostUsd ?? null,
		i18n.language,
	);
	const showsPlan = Boolean(
		planUsage && (planUsage.limits.length > 0 || cost !== null),
	);

	return (
		<HoverCard closeDelay={80} openDelay={150}>
			<HoverCardTrigger asChild>
				<Button
					aria-label={
						showsPlan
							? t(
									'workbench:context-usage.aria-label-with-plan',
									'Context and plan usage',
								)
							: t('workbench:context-usage.aria-label', 'Context usage')
					}
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
				{showsPlan && planUsage ? (
					<PlanUsageSection cost={cost} usage={planUsage} />
				) : null}
			</HoverCardContent>
		</HoverCard>
	);
}
