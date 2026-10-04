import type { TFunction } from 'i18next';
import { FileTextIcon, HourglassIcon, SquareIcon, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
	/**
	 * Resolves how to open a job's workspace, or null when it cannot be opened
	 * from here — no workspace route to move to, or a workspace the route does
	 * not list — so the row never offers a link that goes nowhere.
	 */
	workspaceOpener?: (job: ComputeJobSnapshot) => (() => void) | null;
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
 * One live job as a flat two-line sidebar row: what it is and how far along on
 * the first line, where it runs and who asked on the second.
 *
 * The row's actions stay out of the way until it is hovered or focused, the
 * way a workspace row's archive button does, so the title gets the width they
 * would otherwise hold. The full command is in the title's tooltip because the
 * row truncates the title and a script's title hides it entirely. A running
 * job offers Stop and a queued one Cancel, so the control says whether it ends
 * work in progress or only gives up a place in line.
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
			className='group/compute-job relative flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-sidebar-accent has-focus-visible:bg-sidebar-accent'
			data-compute-job-state={job.state}
		>
			<span className='grid h-4 w-4 shrink-0 place-items-center text-muted-foreground'>
				{running ? (
					<Spinner aria-hidden='true' className='size-3.5' />
				) : (
					<HourglassIcon aria-hidden='true' className='size-3.5' />
				)}
			</span>
			<div className='flex min-w-0 flex-1 flex-col gap-0.5'>
				<div className='flex min-w-0 items-center gap-2'>
					<Tooltip>
						<TooltipTrigger asChild>
							<span
								className={cn(
									'min-w-0 flex-1 truncate text-xs leading-4',
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
					<JobTiming job={job} />
				</div>
				<div className='flex min-w-0 items-center gap-1 text-muted-foreground text-xxs leading-4'>
					{job.workspaceName ? (
						<>
							<WorkspaceName
								job={job}
								name={job.workspaceName}
								workspaceOpener={actions.workspaceOpener}
							/>
							<span aria-hidden='true' className='shrink-0'>
								·
							</span>
						</>
					) : null}
					<InitiatorLabel initiator={job.initiator} />
				</div>
			</div>
			<div className='absolute inset-y-0 right-0 flex items-center gap-0.5 rounded-r-md bg-sidebar-accent pr-1 opacity-0 transition-opacity before:pointer-events-none before:absolute before:inset-y-0 before:right-full before:w-4 before:bg-linear-to-r before:from-transparent before:to-sidebar-accent has-focus-visible:opacity-100 group-hover/compute-job:opacity-100'>
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
			</div>
		</li>
	);
}

/**
 * The job's workspace, as a link-styled button that opens it when the host can
 * resolve it to a workspace route, and as plain text when it cannot.
 */
function WorkspaceName({
	job,
	name,
	workspaceOpener,
}: {
	job: ComputeJobSnapshot;
	name: string;
	workspaceOpener?: ComputeJobRowActions['workspaceOpener'];
}) {
	const { t } = useTranslation();
	const openWorkspace = workspaceOpener?.(job) ?? null;

	if (!openWorkspace) {
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
					className='min-w-0 truncate rounded-sm text-left underline-offset-2 outline-none hover:text-sidebar-foreground hover:underline focus-visible:ring-2 focus-visible:ring-sidebar-ring'
					onClick={openWorkspace}
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
					className='size-6 shrink-0 text-muted-foreground hover:bg-sidebar hover:text-sidebar-foreground dark:hover:bg-sidebar'
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
 * Names who asked for a job — an agent, the app on its own, or the user — as
 * plain text in the row's second line, with a tooltip spelling out what the
 * short word means.
 */
function InitiatorLabel({ initiator }: { initiator: ComputeJobInitiator }) {
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
				<span className='shrink-0'>{label}</span>
			</TooltipTrigger>
			<TooltipContent>{hint}</TooltipContent>
		</Tooltip>
	);
}

/**
 * Queue position for a waiting job, live elapsed time for a running one, set
 * right-aligned on the title line. The position shows in its short form, with
 * the full phrase for assistive tech.
 */
function JobTiming({ job }: { job: ComputeJobSnapshot }) {
	const { t } = useTranslation();

	if (job.state === 'running') {
		return <RunningElapsed startedAt={job.startedAt ?? job.enqueuedAt} />;
	}
	const position = job.position ?? 0;
	return (
		<span className='shrink-0 text-muted-foreground text-xxs tabular-nums leading-4'>
			<span aria-hidden='true'>
				{t(
					'workbench:navigation-sidebar.compute-queue.queue-position-short',
					'#{{position}}',
					{ position },
				)}
			</span>
			<span className='sr-only'>
				{t(
					'workbench:navigation-sidebar.compute-queue.queue-position',
					'#{{position}} in queue',
					{ position },
				)}
			</span>
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
		<span
			aria-hidden='true'
			className='shrink-0 text-muted-foreground text-xxs tabular-nums leading-4'
		>
			{formatElapsedSeconds(elapsedMs)}
		</span>
	);
}
