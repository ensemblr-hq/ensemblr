import type { TFunction } from 'i18next';
import { FileTextIcon, HourglassIcon, SquareIcon, XIcon } from 'lucide-react';
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
import { formatElapsedSeconds } from '@/renderer/lib/format-duration';
import { cn } from '@/renderer/lib/utils';
import type {
	ComputeJobInitiator,
	ComputeJobSnapshot,
} from '@/shared/compute-queue';
import { formatRunScriptLabel } from '@/shared/scripts';

/** How often a running job's elapsed time repaints; seconds are the finest unit shown. */
const ELAPSED_TICK_MS = 1000;

/** What a row can do with its job, wired by whoever hosts the panel. */
export interface ComputeJobRowActions {
	onCancel: (jobId: string) => void;
	onOpenLog: (job: ComputeJobSnapshot) => void;
	/** Opens the job's workspace; absent where there is no workspace route to move to. */
	onOpenWorkspace?: (job: ComputeJobSnapshot) => void;
}

/**
 * Names a job the way the user knows it: a repository script by what it is,
 * since its command (`scripts/setup.sh`) says nothing about its role, and a
 * command by the label its agent gave it.
 * @param job - The job to name.
 * @param t - Translator for the script names.
 * @returns The row's title.
 */
function jobTitle(job: ComputeJobSnapshot, t: TFunction): string {
	switch (job.script?.kind) {
		case 'setup':
			return t(
				'workbench:navigation-sidebar.compute-queue.script.setup',
				'Setup script',
			);
		case 'archive':
			return t(
				'workbench:navigation-sidebar.compute-queue.script.archive',
				'Archive script',
			);
		case 'run':
			return job.script.name
				? t(
						'workbench:navigation-sidebar.compute-queue.script.run-named',
						'Run script: {{name}}',
						{ name: formatRunScriptLabel(job.script.name) },
					)
				: t(
						'workbench:navigation-sidebar.compute-queue.script.run',
						'Run script',
					);
		default:
			return job.label;
	}
}

/**
 * One live job: its state, what it is, where it runs, who asked, and the
 * actions still open to the user. The full command is in the title's tooltip
 * because the row truncates the title and a script's title hides it entirely.
 * A running job offers Stop and a queued one Cancel, so the control says
 * whether it ends work in progress or only gives up a place in line.
 */
export function ComputeJobRow({
	actions,
	job,
}: {
	actions: ComputeJobRowActions;
	job: ComputeJobSnapshot;
}) {
	const { t } = useTranslation();
	const running = job.state === 'running';
	const title = jobTitle(job, t);

	return (
		<li
			className='flex items-center gap-1.5 rounded-md bg-sidebar px-1.5 py-1'
			data-compute-job-state={job.state}
		>
			{running ? (
				<Spinner
					aria-hidden='true'
					className='size-3.5 shrink-0 text-muted-foreground'
				/>
			) : (
				<HourglassIcon
					aria-hidden='true'
					className='size-3.5 shrink-0 text-muted-foreground'
				/>
			)}
			<div className='flex min-w-0 flex-1 flex-col'>
				<Tooltip>
					<TooltipTrigger asChild>
						<span
							className={cn(
								'truncate text-xxs leading-4',
								job.script ? 'font-medium' : 'font-mono',
								running ? 'text-sidebar-foreground' : 'text-muted-foreground',
							)}
						>
							{title}
						</span>
					</TooltipTrigger>
					<TooltipContent className='max-w-96 break-all font-mono'>
						{job.command}
					</TooltipContent>
				</Tooltip>
				<span className='flex min-w-0 items-center gap-1 text-muted-foreground text-xxs leading-4'>
					<WorkspaceName job={job} onOpenWorkspace={actions.onOpenWorkspace} />
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
					onClick={() => actions.onOpenLog(job)}
				>
					<FileTextIcon />
				</RowAction>
			) : null}
			{running ? (
				<RowAction
					label={t(
						'workbench:navigation-sidebar.compute-queue.stop',
						'Stop {{label}}',
						{ label: title },
					)}
					onClick={() => actions.onCancel(job.id)}
				>
					<SquareIcon />
				</RowAction>
			) : (
				<RowAction
					label={t(
						'workbench:navigation-sidebar.compute-queue.cancel',
						'Cancel {{label}}',
						{ label: title },
					)}
					onClick={() => actions.onCancel(job.id)}
				>
					<XIcon />
				</RowAction>
			)}
		</li>
	);
}

/**
 * The job's workspace, as a link-styled button that opens it when the host can
 * navigate, and as plain text when it cannot.
 */
function WorkspaceName({
	job,
	onOpenWorkspace,
}: {
	job: ComputeJobSnapshot;
	onOpenWorkspace?: (job: ComputeJobSnapshot) => void;
}) {
	const { t } = useTranslation();
	const name = job.workspaceName ?? '';

	if (!onOpenWorkspace || !name) {
		return <span className='min-w-0 truncate'>{name}</span>;
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					aria-label={t(
						'workbench:navigation-sidebar.compute-queue.open-workspace-aria',
						'Open workspace {{workspace}}',
						{ workspace: name },
					)}
					className='min-w-0 truncate rounded-sm text-left underline-offset-2 outline-none hover:text-sidebar-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring'
					onClick={() => onOpenWorkspace(job)}
					type='button'
				>
					{name}
				</button>
			</TooltipTrigger>
			<TooltipContent>
				{t(
					'workbench:navigation-sidebar.compute-queue.open-workspace',
					'Open workspace',
				)}
			</TooltipContent>
		</Tooltip>
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

/**
 * Names who asked for a job — an agent, the app on its own, or the user — with
 * a tooltip spelling out what the short badge means.
 */
function InitiatorBadge({ initiator }: { initiator: ComputeJobInitiator }) {
	const { t } = useTranslation();
	const { hint, label } = {
		agent: {
			hint: t(
				'workbench:navigation-sidebar.compute-queue.initiator-hint.agent',
				'Started by an agent',
			),
			label: t(
				'workbench:navigation-sidebar.compute-queue.initiator.agent',
				'Agent',
			),
		},
		auto: {
			hint: t(
				'workbench:navigation-sidebar.compute-queue.initiator-hint.auto',
				'Started automatically by Ensemblr',
			),
			label: t(
				'workbench:navigation-sidebar.compute-queue.initiator.automatic',
				'Auto',
			),
		},
		user: {
			hint: t(
				'workbench:navigation-sidebar.compute-queue.initiator-hint.user',
				'Started by you',
			),
			label: t(
				'workbench:navigation-sidebar.compute-queue.initiator.user',
				'You',
			),
		},
	}[initiator];

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Badge className='h-4 shrink-0 px-1.5 text-xxs' variant='secondary'>
					{label}
				</Badge>
			</TooltipTrigger>
			<TooltipContent>{hint}</TooltipContent>
		</Tooltip>
	);
}

/** Queue position for a waiting job, live elapsed time for a running one. */
function JobTiming({ job }: { job: ComputeJobSnapshot }) {
	const { t } = useTranslation();

	if (job.state === 'running') {
		return <RunningElapsed startedAt={job.startedAt ?? job.enqueuedAt} />;
	}
	return (
		<span className='shrink-0 tabular-nums'>
			{t(
				'workbench:navigation-sidebar.compute-queue.queue-position',
				'#{{position}} in queue',
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
		<span aria-hidden='true' className='shrink-0 tabular-nums'>
			{formatElapsedSeconds(elapsedMs)}
		</span>
	);
}
