import { FileTextIcon, ListOrderedIcon, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Spinner } from '@/renderer/components/ui/spinner';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { useElapsedMs } from '@/renderer/hooks/use-elapsed-ms';
import { formatTurnDuration } from '@/renderer/lib/format-duration';
import type {
	ComputeJobInitiator,
	ComputeJobSnapshot,
	ComputeQueueSnapshot,
} from '@/shared/compute-queue';

/** How often a running job's elapsed time repaints; seconds are the finest unit shown. */
const ELAPSED_TICK_MS = 1000;

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
 * The sidebar's view of the app-wide compute queue: the commands every
 * workspace has waiting for or holding a slot, with a cancel on each.
 *
 * Renders nothing while no job is live, so an idle queue costs the sidebar no
 * space. Finished jobs are the queue's history, not this panel's business.
 */
export function ComputeQueuePanel({
	onCancel,
	onOpenLog,
	snapshot,
}: {
	onCancel: (jobId: string) => void;
	onOpenLog: (job: ComputeJobSnapshot) => void;
	snapshot: ComputeQueueSnapshot;
}) {
	const { t } = useTranslation();
	const jobs = liveJobsInOrder(snapshot.jobs);
	if (jobs.length === 0) {
		return null;
	}
	const runningCount = jobs.filter((job) => job.state === 'running').length;
	const queuedCount = jobs.length - runningCount;

	return (
		<section
			aria-label={t(
				'workbench:navigation-sidebar.compute-queue.title',
				'Compute queue',
			)}
			className='flex flex-col gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent p-2.5'
			data-sidebar-compute-queue=''
		>
			<header className='flex items-center justify-between gap-2'>
				<div className='flex min-w-0 flex-col gap-0.5'>
					<h2 className='font-medium text-sidebar-foreground text-xs leading-4'>
						{t(
							'workbench:navigation-sidebar.compute-queue.title',
							'Compute queue',
						)}
					</h2>
					<p className='text-muted-foreground text-xxs leading-4'>
						{t(
							'workbench:navigation-sidebar.compute-queue.summary',
							'{{running}} running · {{queued}} queued',
							{ queued: queuedCount, running: runningCount },
						)}
					</p>
				</div>
				<Tooltip>
					<TooltipTrigger asChild>
						<Badge className='shrink-0' variant='outline'>
							{t(
								'workbench:navigation-sidebar.compute-queue.slots',
								'{{inUse}}/{{slots}}',
								{ inUse: snapshot.inUse, slots: snapshot.slots },
							)}
						</Badge>
					</TooltipTrigger>
					<TooltipContent>
						{t(
							'workbench:navigation-sidebar.compute-queue.slots-hint',
							'Slots in use',
						)}
					</TooltipContent>
				</Tooltip>
			</header>
			<ul className='flex max-h-48 flex-col gap-1 overflow-y-auto'>
				{jobs.map((job) => (
					<ComputeJobRow
						job={job}
						key={job.id}
						onCancel={onCancel}
						onOpenLog={onOpenLog}
					/>
				))}
			</ul>
		</section>
	);
}

/**
 * One live job: its state, what it runs, where, who asked, and the actions
 * still open to the user. The full command is in the label's tooltip because the
 * row truncates it.
 */
function ComputeJobRow({
	job,
	onCancel,
	onOpenLog,
}: {
	job: ComputeJobSnapshot;
	onCancel: (jobId: string) => void;
	onOpenLog: (job: ComputeJobSnapshot) => void;
}) {
	const { t } = useTranslation();

	return (
		<li
			className='flex items-center gap-1.5 rounded-md bg-sidebar px-1.5 py-1'
			data-compute-job-state={job.state}
		>
			{job.state === 'running' ? (
				<Spinner
					aria-hidden='true'
					className='size-3.5 shrink-0 text-muted-foreground'
				/>
			) : (
				<ListOrderedIcon
					aria-hidden='true'
					className='size-3.5 shrink-0 text-muted-foreground'
				/>
			)}
			<div className='flex min-w-0 flex-1 flex-col'>
				<Tooltip>
					<TooltipTrigger asChild>
						<span className='truncate font-mono text-sidebar-foreground text-xxs leading-4'>
							{job.label}
						</span>
					</TooltipTrigger>
					<TooltipContent className='max-w-96 break-all font-mono'>
						{job.command}
					</TooltipContent>
				</Tooltip>
				<span className='flex items-center gap-1 text-muted-foreground text-xxs leading-4'>
					<span className='truncate'>{job.workspaceName ?? ''}</span>
					<InitiatorBadge initiator={job.initiator} />
					<JobTiming job={job} />
				</span>
			</div>
			{job.kind === 'command' && job.logPath ? (
				<RowAction
					label={t(
						'workbench:navigation-sidebar.compute-queue.open-log',
						'Open log',
					)}
					onClick={() => onOpenLog(job)}
				>
					<FileTextIcon />
				</RowAction>
			) : null}
			<RowAction
				label={t(
					'workbench:navigation-sidebar.compute-queue.cancel',
					'Cancel {{label}}',
					{ label: job.label },
				)}
				onClick={() => onCancel(job.id)}
			>
				<XIcon />
			</RowAction>
		</li>
	);
}

/** Icon-only row action; the label is both its accessible name and its tooltip. */
function RowAction({
	children,
	label,
	onClick,
}: {
	children: React.ReactNode;
	label: string;
	onClick: () => void;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					aria-label={label}
					className='size-6 shrink-0'
					onClick={onClick}
					size='icon-xs'
					variant='ghost'
				>
					{children}
				</Button>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

/** Names who asked for a job: an agent, the app's own setup, or the user. */
function InitiatorBadge({ initiator }: { initiator: ComputeJobInitiator }) {
	const { t } = useTranslation();
	const label = {
		agent: t(
			'workbench:navigation-sidebar.compute-queue.initiator.agent',
			'Agent',
		),
		auto: t(
			'workbench:navigation-sidebar.compute-queue.initiator.auto',
			'Setup',
		),
		user: t('workbench:navigation-sidebar.compute-queue.initiator.user', 'You'),
	}[initiator];

	return (
		<Badge className='h-4 px-1.5 text-xxs' variant='secondary'>
			{label}
		</Badge>
	);
}

/** Queue position for a waiting job, live elapsed time for a running one. */
function JobTiming({ job }: { job: ComputeJobSnapshot }) {
	const { t } = useTranslation();

	if (job.state === 'running') {
		return <RunningElapsed startedAt={job.startedAt ?? job.enqueuedAt} />;
	}
	return (
		<span className='tabular-nums'>
			{t(
				'workbench:navigation-sidebar.compute-queue.position',
				'#{{position}}',
				{ position: job.position ?? 0 },
			)}
		</span>
	);
}

/**
 * A running job's elapsed time. Only running rows mount it, so a queued row
 * holds no interval. Hidden from assistive tech: a ticking timer is noise.
 */
function RunningElapsed({ startedAt }: { startedAt: number }) {
	const elapsedMs = useElapsedMs(startedAt, ELAPSED_TICK_MS);

	return (
		<span aria-hidden='true' className='tabular-nums'>
			{formatTurnDuration(elapsedMs)}
		</span>
	);
}
