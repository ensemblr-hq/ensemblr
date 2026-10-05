import { ChevronRightIcon, HourglassIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@/renderer/components/ui/collapsible';
import { Spinner } from '@/renderer/components/ui/spinner';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { cn } from '@/renderer/lib/utils';
import type {
	ComputeJobSnapshot,
	ComputeQueueSnapshot,
} from '@/shared/compute-queue';

import { ComputeJobRow, type ComputeJobRowActions } from './compute-job-row';

/**
 * Jobs still waiting for or holding a slot, running first and then queued in
 * line order, so the list reads in the order work will finish starting.
 * @param jobs - Every job the queue reports, finished ones included
 * @returns The live jobs in display order
 */
function liveJobsInOrder(
	jobs: readonly ComputeJobSnapshot[],
): ComputeJobSnapshot[] {
	const running = jobs
		.filter((job) => job.state === 'running')
		.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
	const queued = jobs
		.filter((job) => job.state === 'queued')
		.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
	return [...running, ...queued];
}

/**
 * Whether the slot count tells the user anything the rows do not. With a single
 * slot, "1/1" only restates that one job is running, so it earns its place only
 * once a user-started script pushes the queue past its limit.
 * @param snapshot - The queue's slot settings and usage
 * @returns True when the header should show slot usage
 */
function showsSlotUsage({ inUse, slots }: ComputeQueueSnapshot): boolean {
	return slots > 1 || inUse > slots;
}

/** Props for {@link ComputeQueuePanel}. */
interface ComputeQueuePanelProps extends ComputeJobRowActions {
	/** Whether only the header shows. */
	collapsed: boolean;
	onCollapsedChange: (collapsed: boolean) => void;
	snapshot: ComputeQueueSnapshot;
}

/**
 * The sidebar's view of the app-wide compute queue: the commands and scripts
 * every workspace has waiting for or holding a slot, with a stop or cancel on
 * each and a start-now on every waiting one. It is a sidebar section rather
 * than a card, so the rows run the full width of the column and line up with
 * the workspace list above them.
 *
 * The whole header is the disclosure control. Collapsed, it carries the
 * running/queued counts the hidden rows would have shown, the way a collapsed
 * repository header carries its workspace count.
 *
 * Renders nothing while no job is live, so an idle queue costs the sidebar no
 * space. Finished jobs are the queue's history, not this panel's business.
 */
export function ComputeQueuePanel({
	collapsed,
	onCollapsedChange,
	snapshot,
	...actions
}: ComputeQueuePanelProps) {
	const { t } = useTranslation();
	const jobs = liveJobsInOrder(snapshot.jobs);
	if (jobs.length === 0) {
		return null;
	}
	const runningCount = jobs.filter((job) => job.state === 'running').length;
	const queuedCount = jobs.length - runningCount;
	const title = t(
		'workbench:navigation-sidebar.compute-queue.title',
		'Compute queue',
	);

	return (
		<Collapsible
			asChild
			onOpenChange={(open) => onCollapsedChange(!open)}
			open={!collapsed}
		>
			<section
				aria-label={title}
				className='flex flex-col'
				data-sidebar-compute-queue=''
			>
				<CollapsibleTrigger className='flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left font-medium text-sidebar-foreground/70 text-xs outline-hidden ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2'>
					<ChevronRightIcon
						aria-hidden='true'
						className={cn(
							'size-4 shrink-0 transition-transform motion-reduce:transition-none',
							!collapsed && 'rotate-90',
						)}
					/>
					<span className='min-w-0 truncate'>{title}</span>
					<span className='flex min-w-0 flex-1 items-center gap-2'>
						{collapsed ? (
							<QueueCounts queued={queuedCount} running={runningCount} />
						) : null}
					</span>
					{showsSlotUsage(snapshot) ? (
						<SlotUsage inUse={snapshot.inUse} slots={snapshot.slots} />
					) : null}
				</CollapsibleTrigger>
				<CollapsibleContent className='overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down motion-reduce:animate-none'>
					<ul className='sleek-scrollbar flex max-h-56 flex-col gap-0.5 overflow-y-auto pt-0.5'>
						{jobs.map((job) => (
							<ComputeJobRow actions={actions} job={job} key={job.id} />
						))}
					</ul>
				</CollapsibleContent>
			</section>
		</Collapsible>
	);
}

/**
 * The collapsed header's account of the hidden rows: a count beside the same
 * spinner and hourglass the rows use, so it fits beside the title at sidebar
 * width where the sentence would not. The sentence stays for assistive tech.
 */
function QueueCounts({ queued, running }: { queued: number; running: number }) {
	const { t } = useTranslation();

	return (
		<>
			<span className='sr-only'>
				{t(
					'workbench:navigation-sidebar.compute-queue.summary',
					'{{running}} running · {{queued}} queued',
					{ queued, running },
				)}
			</span>
			{running > 0 ? (
				<span
					aria-hidden='true'
					className='flex shrink-0 items-center gap-1 font-normal text-muted-foreground text-xxs tabular-nums'
					data-compute-queue-count='running'
				>
					<Spinner aria-hidden='true' className='size-3' />
					{running}
				</span>
			) : null}
			{queued > 0 ? (
				<span
					aria-hidden='true'
					className='flex shrink-0 items-center gap-1 font-normal text-muted-foreground text-xxs tabular-nums'
					data-compute-queue-count='queued'
				>
					<HourglassIcon className='size-3' />
					{queued}
				</span>
			) : null}
		</>
	);
}

/**
 * Slots in use against the configured count, as a bare ratio: the header is
 * the queue's, so the unit goes without saying, and the tooltip and the
 * screen-reader text spell it out. The count can run past the limit because a
 * script the user starts, or a queued job the user starts now, takes a slot at
 * once rather than waiting behind agents.
 */
function SlotUsage({ inUse, slots }: { inUse: number; slots: number }) {
	const { t } = useTranslation();

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span
					className='shrink-0 font-normal text-muted-foreground text-xxs tabular-nums'
					data-compute-queue-slots=''
				>
					<span aria-hidden='true'>
						{inUse}/{slots}
					</span>
					<span className='sr-only'>
						{t('workbench:navigation-sidebar.compute-queue.slot-usage-aria', {
							count: slots,
							defaultValue_one: '{{inUse}} of {{count}} slot in use',
							defaultValue_other: '{{inUse}} of {{count}} slots in use',
							inUse,
						})}
					</span>
				</span>
			</TooltipTrigger>
			<TooltipContent className='max-w-64'>
				{t(
					'workbench:navigation-sidebar.compute-queue.slots-explainer',
					'Slots in use out of the total. Heavy commands wait for a free slot; a script you start yourself, or a queued job you start now, takes one at once, even when all are busy.',
				)}
			</TooltipContent>
		</Tooltip>
	);
}
