import { useState } from 'react';

import { ComputeQueuePanel } from '@/renderer/components/workbench-shell/navigation-sidebar/compute-queue-panel';
import type {
	ComputeJobSnapshot,
	ComputeQueueSnapshot,
} from '@/shared/compute-queue';

import {
	COMPUTE_QUEUE_FIXTURES,
	INTERACTIVE_COMPUTE_QUEUE,
} from './compute-queue-fixtures.ts';
import { SceneSection } from './scene-chrome.tsx';

/** Opens every workspace from a row as a no-op, so names render as the links they are in the app. */
const INERT_WORKSPACE_OPENER = () => () => undefined;

/**
 * The compute queue panel the navigation sidebar pins above its update panel,
 * in every queue shape it has to survive, plus one live instance whose
 * collapse, cancel, open-log, and workspace link actually respond.
 */
export function ComputeQueueScene() {
	return (
		<SceneSection
			label='sidebar compute queue — ComputeQueuePanel'
			note='pinned to the navigation sidebar’s footer at the shipped 16rem width; hover or tab into a row for its actions; the panel leaves entirely while nothing is queued or running'
		>
			<div className='flex flex-wrap items-start gap-4'>
				<InteractiveRow />
				{COMPUTE_QUEUE_FIXTURES.map((fixture) => (
					<FixtureRow
						collapsed={fixture.collapsed}
						key={fixture.label}
						label={fixture.label}
						note={fixture.note}
						snapshot={fixture.snapshot}
					/>
				))}
			</div>
		</SceneSection>
	);
}

/** One queue shape in situ, with its own collapse state so each can still be toggled. */
function FixtureRow({
	collapsed: initiallyCollapsed,
	label,
	note,
	snapshot,
}: {
	collapsed: boolean;
	label: string;
	note: string;
	snapshot: ComputeQueueSnapshot;
}) {
	const [collapsed, setCollapsed] = useState(initiallyCollapsed);

	return (
		<RowFrame label={label} note={note}>
			<ComputeQueuePanel
				collapsed={collapsed}
				onCancel={() => undefined}
				onCollapsedChange={setCollapsed}
				onOpenLog={() => undefined}
				onStartNow={() => undefined}
				snapshot={snapshot}
				workspaceOpener={INERT_WORKSPACE_OPENER}
			/>
		</RowFrame>
	);
}

/**
 * A queue the scene's actions really change: cancelling drops the job and
 * moves the line up, and opening a log or a workspace reports what the app
 * would have opened.
 */
function InteractiveRow() {
	const [snapshot, setSnapshot] = useState(INTERACTIVE_COMPUTE_QUEUE);
	const [collapsed, setCollapsed] = useState(false);
	const [lastAction, setLastAction] = useState('—');

	return (
		<RowFrame
			footer={
				<div className='flex flex-col gap-1'>
					<p className='font-mono text-muted-foreground text-xxs leading-4'>
						last action: {lastAction}
					</p>
					<button
						className='self-start rounded-md border px-2 py-0.5 font-mono text-xxs hover:bg-accent/50'
						onClick={() => {
							setSnapshot(INTERACTIVE_COMPUTE_QUEUE);
							setLastAction('—');
						}}
						type='button'
					>
						reset queue
					</button>
				</div>
			}
			label='interactive'
			note='collapse, start now, cancel, stop, open a log, or open a workspace — the actions are live here'
		>
			<ComputeQueuePanel
				collapsed={collapsed}
				onCancel={(jobId) => {
					setSnapshot((current) => withoutJob(current, jobId));
					setLastAction(`cancel ${jobId}`);
				}}
				onCollapsedChange={setCollapsed}
				onOpenLog={(job) => setLastAction(`open log ${job.logPath ?? ''}`)}
				onStartNow={(jobId) => {
					setSnapshot((current) => withJobStarted(current, jobId));
					setLastAction(`start now ${jobId}`);
				}}
				snapshot={snapshot}
				workspaceOpener={(job) => () =>
					setLastAction(`open workspace ${job.workspaceName ?? ''}`)
				}
			/>
		</RowFrame>
	);
}

/**
 * Removes a job the way main would report it gone: the queued jobs behind it
 * move up a place, and a running one gives its slot back.
 * @param snapshot - The queue before the cancel
 * @param jobId - The job being cancelled or stopped
 * @returns The queue after it
 */
function withoutJob(
	snapshot: ComputeQueueSnapshot,
	jobId: string,
): ComputeQueueSnapshot {
	const remaining = snapshot.jobs.filter((entry) => entry.id !== jobId);
	const queuedIds = remaining
		.filter((entry) => entry.state === 'queued')
		.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
		.map((entry) => entry.id);
	const jobs = remaining.map(
		(entry): ComputeJobSnapshot =>
			entry.state === 'queued'
				? { ...entry, position: queuedIds.indexOf(entry.id) + 1 }
				: entry,
	);
	return {
		...snapshot,
		inUse: jobs.filter((entry) => entry.state === 'running').length,
		jobs,
	};
}

/**
 * Starts a queued job the way main would report it: running at once, over the
 * slot limit if every slot is busy, with the line behind it moving up a place.
 * @param snapshot - The queue before the start
 * @param jobId - The queued job being started now
 * @returns The queue after it
 */
function withJobStarted(
	snapshot: ComputeQueueSnapshot,
	jobId: string,
): ComputeQueueSnapshot {
	const started = snapshot.jobs.find((entry) => entry.id === jobId);
	if (started?.state !== 'queued') {
		return snapshot;
	}
	const rest = withoutJob(snapshot, jobId);
	return {
		...rest,
		inUse: rest.inUse + 1,
		jobs: [
			...rest.jobs,
			{ ...started, position: null, startedAt: Date.now(), state: 'running' },
		],
	};
}

/**
 * A labelled 16rem sidebar column with the panel at the foot of it, under the
 * same footer rule the shipped wrapper draws.
 */
function RowFrame({
	children,
	footer,
	label,
	note,
}: {
	children: React.ReactNode;
	footer?: React.ReactNode;
	label: string;
	note: string;
}) {
	return (
		<section className='flex w-64 flex-col gap-1.5'>
			<h3 className='font-mono text-muted-foreground text-xxs uppercase tracking-wide'>
				{label}
			</h3>
			<p className='text-muted-foreground text-xxs leading-4'>{note}</p>
			<div className='flex min-h-40 flex-col justify-end rounded-md border border-sidebar-border bg-sidebar text-sidebar-foreground'>
				<div className='border-sidebar-border border-t px-2 py-1.5'>
					{children}
				</div>
			</div>
			{footer}
		</section>
	);
}
