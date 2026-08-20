import { useMutation } from '@tanstack/react-query';
import { RefreshCwIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { refreshAgentPlanUsage } from '@/renderer/api/ensemblr-queries';
import { Button } from '@/renderer/components/ui/button';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/renderer/components/ui/popover';
import { Progress } from '@/renderer/components/ui/progress';
import {
	formatSessionCost,
	planStatusLabel,
	planWindowLabel,
	planWindowResetLabel,
} from '@/renderer/lib/plan-limit-text';
import { cn } from '@/renderer/lib/utils';
import type {
	ComposerContextUsage,
	ComposerPlanUsage,
} from '@/renderer/types/workbench';

/** Stands in for both halves of the count when no window is known. */
const UNKNOWN_TOKENS = '—';

/** Stands in for a plan window the runtime named but reported no reading for. */
const UNKNOWN_UTILIZATION = '—';

/**
 * The bar for one plan window, or a hollow track when the runtime named the
 * window without measuring it. A filled bar at zero and an unmeasured window
 * look identical, and of the two readings "you have used none of your plan" is
 * the one a user acts on — so an unknown window is drawn as an outline it can
 * never be mistaken for.
 *
 * Both readings are the same named progressbar, so the window is one thing to a
 * screen reader whether or not it has been measured; the outline is the track
 * itself, emptied and dashed, rather than a second element standing in for one.
 */
function PlanWindowBar({
	label,
	utilization,
}: {
	label: string;
	utilization: number | null;
}) {
	return (
		<Progress
			aria-label={label}
			className={
				utilization === null
					? 'h-1.5 border border-border border-dashed bg-transparent'
					: 'h-1.5 bg-muted'
			}
			value={utilization}
		/>
	);
}

/** The card's plan re-read affordance, held open across the card's own closes. */
interface PlanUsageRefresh {
	isPending: boolean;
	run: () => void;
}

/**
 * Binds a re-read of the account's plan windows to the chat's live session, or
 * reports that there is no runtime to ask.
 *
 * The gauge otherwise only moves when the runtime volunteers a reading — on a
 * turn boundary, or on whichever window a push happens to name — so a user who
 * opens the card mid-turn is reading a figure minutes out of date with no way to
 * ask for a fresher one. The reading itself arrives on the session event stream
 * like any other, which is why a click reports nothing but failure.
 *
 * This sits above the card rather than inside it because the card unmounts every
 * time it closes: a pending flag owned by the popover's contents would reset the
 * moment the user looked away, leaving an idle-looking control over a read that
 * is still running.
 * @param liveSessionId - Session whose runtime can answer, null when none can.
 * @returns The affordance to draw, or null when there is nothing to ask.
 */
function usePlanUsageRefresh(
	liveSessionId: string | null,
): PlanUsageRefresh | null {
	const { t } = useTranslation();
	// react-doctor-disable-next-line -- The reading lands on the session event stream rather than in this call's result, so the gauge and the event cache are both already updated by the subscription; invalidating the branch here would re-read the transcript mid-stream and drop the deltas in flight.
	const { isPending, mutateAsync } = useMutation({
		mutationFn: (sessionId: string) => refreshAgentPlanUsage({ sessionId }),
	});

	if (liveSessionId === null) {
		return null;
	}

	/** Runs the refresh and reports the one outcome the card cannot show itself. */
	const refresh = async (): Promise<void> => {
		const outcome = await mutateAsync(liveSessionId).catch(() => ({
			refreshed: false,
		}));
		if (!outcome.refreshed) {
			toast.error(
				t(
					'workbench:plan-usage.refresh-failed',
					'Could not refresh plan usage.',
				),
			);
		}
	};

	return { isPending, run: () => void refresh() };
}

/** The re-read control, spinning and inert while the runtime is being asked. */
function PlanUsageRefreshButton({ isPending, run }: PlanUsageRefresh) {
	const { t } = useTranslation();

	return (
		<Button
			aria-label={t('workbench:plan-usage.refresh', 'Refresh plan usage')}
			disabled={isPending}
			onClick={run}
			size='icon-xs'
			type='button'
			variant='subtle'
		>
			<RefreshCwIcon
				aria-hidden='true'
				className={cn(isPending && 'animate-spin')}
			/>
		</Button>
	);
}

/**
 * The plan half of the context card: the runtime's spend verdict when it is
 * anything but plain `allowed`, a bar per reported window, the running session
 * cost, and the note that the cost is an estimate rather than a bill.
 */
function PlanUsageSection({
	cost,
	refresh,
	usage,
}: {
	cost: string | null;
	refresh: PlanUsageRefresh | null;
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
				<div className='-mr-1 flex items-center gap-1'>
					{cost ? (
						<span className='text-muted-foreground text-xs tabular-nums'>
							{cost}
						</span>
					) : null}
					{refresh ? <PlanUsageRefreshButton {...refresh} /> : null}
				</div>
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
				const label = planWindowLabel(window, t);
				const resets = planWindowResetLabel(window.resetsAt, t);
				return (
					<div className='flex flex-col gap-1' key={window.id}>
						<div className='flex items-center justify-between gap-6 text-xs'>
							<span>{label}</span>
							<span className='text-muted-foreground tabular-nums'>
								{window.utilization === null
									? UNKNOWN_UTILIZATION
									: `${Math.round(window.utilization)}%`}
							</span>
						</div>
						<PlanWindowBar label={label} utilization={window.utilization} />
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
 * running cost folded into the same popover. Both answer "how much room is
 * left", one within the turn and one within the billing window, so they belong
 * behind one control rather than two competing gauges on the same row.
 *
 * A popover rather than a hover card because the card carries an action: a hover
 * card's trigger closes it on blur and portals its content out of the trigger's
 * tab position, so a control inside one can be clicked but never focused.
 */
export function ContextIndicator({
	liveSessionId = null,
	planUsage = null,
	usage,
}: {
	/**
	 * Chat's session while its runtime is attached, which the card's refresh
	 * control asks. Null for a chat whose runtime is detached — a chat reopened
	 * after a restart still shows its persisted readings, and there is nothing
	 * running to ask for fresher ones.
	 */
	liveSessionId?: string | null;
	planUsage?: ComposerPlanUsage | null;
	usage: ComposerContextUsage | null;
}) {
	const { i18n, t } = useTranslation();
	const refresh = usePlanUsageRefresh(liveSessionId);
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
		<Popover>
			<PopoverTrigger asChild>
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
			</PopoverTrigger>
			<PopoverContent align='end' className='w-80 p-4' sideOffset={4}>
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
					<PlanUsageSection cost={cost} refresh={refresh} usage={planUsage} />
				) : null}
			</PopoverContent>
		</Popover>
	);
}
