import type { TFunction } from 'i18next';
import { HourglassIcon, PlayIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { useElapsedMs } from '@/renderer/hooks/use-elapsed-ms';
import { formatElapsedSeconds } from '@/renderer/lib/format-duration';
import type { WorkspaceScriptQueuedJob } from '@/renderer/types/workbench';
import { formatRunScriptLabel } from '@/shared/scripts';

/** How often the wait time repaints; seconds are the finest unit it shows. */
const WAIT_TICK_MS = 1000;

/**
 * Names the waiting launch by what it is: setup, or the run script it starts.
 * @param job - The queued launch.
 * @param t - Translator bound to the active language.
 * @returns The panel's title.
 */
function queuedTitle(job: WorkspaceScriptQueuedJob, t: TFunction): string {
	if (job.kind === 'setup') {
		return t(
			'workbench:dock-panel.script-queued.title.setup',
			'Setup is queued',
		);
	}

	return job.scriptName
		? t(
				'workbench:dock-panel.script-queued.title.run-named',
				'{{name}} is queued',
				{ name: formatRunScriptLabel(job.scriptName) },
			)
		: t('workbench:dock-panel.script-queued.title.run', 'Run script is queued');
}

/**
 * Empty state for the Setup or Run dock tab while a launch of its script waits
 * for a compute-queue slot. Without it the tab reads as "not run" and the user
 * cannot tell a script that is coming from one that never will.
 *
 * It says why the script is waiting, where it stands in line, how long it has
 * waited, and who queued it, and offers the two ways out — the same pair the
 * sidebar's queue row offers for this job: Start now, which grants it a slot at
 * once, and Cancel, which gives up its place. The host binds both to this job's
 * id, so neither can reach another launch or another script's session. The
 * live terminal replaces the panel the moment the slot comes.
 */
export function ScriptQueuedEmptyState({
	job,
	onCancel,
	onStartNow,
}: {
	job: WorkspaceScriptQueuedJob;
	onCancel: () => void;
	onStartNow: () => void;
}) {
	const { t } = useTranslation();

	return (
		<div className='flex h-full items-center justify-center bg-sidebar p-4'>
			<div className='flex max-w-80 flex-col items-center gap-2 text-center'>
				<div className='grid size-8 place-items-center rounded-md border border-border bg-card text-muted-foreground'>
					<HourglassIcon aria-hidden='true' className='size-4' />
				</div>
				<div className='font-medium text-sm'>{queuedTitle(job, t)}</div>
				<p className='text-muted-foreground text-xs leading-5'>
					{t(
						'workbench:dock-panel.script-queued.detail',
						'Waiting for a free compute slot. Output will appear here once it starts.',
					)}
				</p>
				<QueueFacts job={job} />
				<div className='mt-1 flex items-center gap-2'>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								className='gap-2'
								onClick={onStartNow}
								size='sm'
								variant='outline'
							>
								<PlayIcon aria-hidden='true' />
								{t('workbench:dock-panel.script-queued.start-now', 'Start now')}
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							{t(
								'workbench:dock-panel.script-queued.start-now-hint',
								'Skip the queue and start it now',
							)}
						</TooltipContent>
					</Tooltip>
					<Button
						className='text-muted-foreground'
						onClick={onCancel}
						size='sm'
						variant='ghost'
					>
						{t('workbench:dock-panel.script-queued.cancel', 'Cancel')}
					</Button>
				</div>
			</div>
		</div>
	);
}

/**
 * The launch's place in line, how long it has waited, and who queued it, as
 * one muted row. Only the place in line is announced as it changes; the wait
 * time ticks every second and would be noise.
 */
function QueueFacts({ job }: { job: WorkspaceScriptQueuedJob }) {
	const { t } = useTranslation();

	return (
		<div className='flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-muted-foreground text-xxs tabular-nums leading-4'>
			{job.position !== null ? (
				<>
					<span aria-live='polite' className='font-medium text-foreground'>
						{job.position === 1
							? t('workbench:dock-panel.script-queued.next', 'Next in line')
							: t(
									'workbench:dock-panel.script-queued.position',
									'#{{position}} in queue',
									{ position: job.position },
								)}
					</span>
					<span aria-hidden='true'>·</span>
				</>
			) : null}
			<WaitingFor enqueuedAt={job.enqueuedAt} />
			<span aria-hidden='true'>·</span>
			<span>{initiatorLabel(job.initiator, t)}</span>
		</div>
	);
}

/**
 * Says who put the launch in the queue, which is also why it waits: the app's
 * own setup on workspace creation and an agent's launch queue, a click does not.
 * @param initiator - Who asked for the launch.
 * @param t - Translator bound to the active language.
 * @returns The phrase naming who queued it.
 */
function initiatorLabel(
	initiator: WorkspaceScriptQueuedJob['initiator'],
	t: TFunction,
): string {
	switch (initiator) {
		case 'agent':
			return t(
				'workbench:dock-panel.script-queued.initiator.agent',
				'Queued by an agent',
			);
		case 'auto':
			return t(
				'workbench:dock-panel.script-queued.initiator.auto',
				'Queued automatically',
			);
		case 'user':
			return t(
				'workbench:dock-panel.script-queued.initiator.user',
				'Queued by you',
			);
	}
}

/**
 * How long the launch has waited, ticking once a second. Its own component so
 * the tick repaints this span rather than the whole panel; hidden from
 * assistive tech for the same reason the sidebar's running timer is.
 */
function WaitingFor({ enqueuedAt }: { enqueuedAt: number }) {
	const { t } = useTranslation();
	const elapsedMs = useElapsedMs(enqueuedAt, WAIT_TICK_MS);

	return (
		<span aria-hidden='true'>
			{t('workbench:dock-panel.script-queued.waiting', 'Waiting {{elapsed}}', {
				elapsed: formatElapsedSeconds(elapsedMs),
			})}
		</span>
	);
}
