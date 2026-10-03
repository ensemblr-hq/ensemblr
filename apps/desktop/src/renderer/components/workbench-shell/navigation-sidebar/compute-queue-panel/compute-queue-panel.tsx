import { ChevronRightIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/renderer/components/ui/badge';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@/renderer/components/ui/collapsible';
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
 * each. The header toggles the list, so a long queue can shrink to its summary
 * without leaving the sidebar.
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

	return (
		<Collapsible
			asChild
			onOpenChange={(open) => onCollapsedChange(!open)}
			open={!collapsed}
		>
			<section
				aria-label={t(
					'workbench:navigation-sidebar.compute-queue.title',
					'Compute queue',
				)}
				className='flex flex-col gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent p-2.5'
				data-sidebar-compute-queue=''
			>
				<header className='flex items-center justify-between gap-2'>
					<CollapsibleTrigger className='flex min-w-0 flex-1 items-start gap-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring'>
						<ChevronRightIcon
							aria-hidden='true'
							className={cn(
								'mt-0.5 size-3 shrink-0 text-muted-foreground transition-transform',
								!collapsed && 'rotate-90',
							)}
						/>
						<span className='flex min-w-0 flex-col gap-0.5'>
							<span className='font-medium text-sidebar-foreground text-xs leading-4'>
								{t(
									'workbench:navigation-sidebar.compute-queue.title',
									'Compute queue',
								)}
							</span>
							<span className='truncate text-muted-foreground text-xxs leading-4'>
								{t(
									'workbench:navigation-sidebar.compute-queue.summary',
									'{{running}} running · {{queued}} queued',
									{ queued: queuedCount, running: runningCount },
								)}
							</span>
						</span>
					</CollapsibleTrigger>
					<SlotsBadge inUse={snapshot.inUse} slots={snapshot.slots} />
				</header>
				<CollapsibleContent asChild>
					<ul className='flex max-h-48 flex-col gap-1 overflow-y-auto'>
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
 * Slots in use against the configured count, with a tooltip saying what a slot
 * is and why the count can run past the limit: a script the user starts takes
 * one at once rather than waiting behind agents.
 */
function SlotsBadge({ inUse, slots }: { inUse: number; slots: number }) {
	const { t } = useTranslation();

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Badge className='shrink-0 tabular-nums' variant='outline'>
					{t('workbench:navigation-sidebar.compute-queue.slot-usage', {
						count: slots,
						defaultValue_one: '{{inUse}}/{{count}} slot',
						defaultValue_other: '{{inUse}}/{{count}} slots',
						inUse,
					})}
				</Badge>
			</TooltipTrigger>
			<TooltipContent className='max-w-64'>
				{t(
					'workbench:navigation-sidebar.compute-queue.slots-explainer',
					'Slots in use out of the total. Heavy commands wait for a free slot; a script you start yourself takes one at once, even when all are busy.',
				)}
			</TooltipContent>
		</Tooltip>
	);
}
