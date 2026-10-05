import { atom } from 'jotai';
import { atomWithStorage, selectAtom } from 'jotai/utils';
import { atomFamily } from 'jotai-family';

import type { WorkspaceScriptQueuedJob } from '@/renderer/types/workbench';
import type {
	ComputeJobSnapshot,
	ComputeQueueSnapshot,
} from '@/shared/compute-queue';

/**
 * The compute queue as main last reported it, or null until the first read
 * lands. Not persisted — every value describes the running process.
 */
export const computeQueueSnapshotAtom = atom<ComputeQueueSnapshot | null>(null);

/**
 * Whether the sidebar's compute queue panel shows only its header. Remembered
 * in localStorage across launches, so a list the user tucked away stays tucked
 * away rather than reopening every time a job arrives; read on the first render
 * so the list never flashes open before the stored choice loads.
 */
export const computeQueuePanelCollapsedAtom = atomWithStorage<boolean>(
	'ensemblr_compute_queue_panel_collapsed',
	false,
	undefined,
	{ getOnInit: true },
);

/** Shared empty answer, so a workspace with nothing queued keeps one reference. */
const NO_QUEUED_SCRIPT_JOBS: readonly WorkspaceScriptQueuedJob[] = [];

/**
 * Narrows a queue job to a setup or run script launch still waiting for its
 * slot in one workspace.
 * @param job - Any job the queue reports.
 * @param workspaceId - The workspace whose launches are wanted.
 * @returns True for a queued setup or run script job in that workspace.
 */
function isQueuedScriptJobIn(
	job: ComputeJobSnapshot,
	workspaceId: string,
): job is ComputeJobSnapshot & {
	script: NonNullable<ComputeJobSnapshot['script']>;
} {
	return (
		job.workspaceId === workspaceId &&
		job.state === 'queued' &&
		(job.script?.kind === 'setup' || job.script?.kind === 'run')
	);
}

/**
 * Picks one workspace's waiting script launches out of the whole queue, in
 * line order, keeping only what the dock shows.
 * @param snapshot - The queue as main last reported it.
 * @param workspaceId - The workspace whose launches are wanted.
 * @returns The workspace's queued script launches, first in line first.
 */
function selectQueuedScriptJobs(
	snapshot: ComputeQueueSnapshot | null,
	workspaceId: string,
): readonly WorkspaceScriptQueuedJob[] {
	const jobs = (snapshot?.jobs ?? [])
		.filter((job) => isQueuedScriptJobIn(job, workspaceId))
		.map(
			(job): WorkspaceScriptQueuedJob => ({
				enqueuedAt: job.enqueuedAt,
				id: job.id,
				initiator: job.initiator,
				kind: job.script.kind,
				position: job.position,
				scriptName: job.script.name,
			}),
		)
		.sort(
			(a, b) =>
				(a.position ?? Number.POSITIVE_INFINITY) -
				(b.position ?? Number.POSITIVE_INFINITY),
		);

	return jobs.length > 0 ? jobs : NO_QUEUED_SCRIPT_JOBS;
}

/**
 * Whether two selections describe the same waiting launches field for field.
 * @param left - The previous selection.
 * @param right - The next selection.
 * @returns True when nothing the dock shows has changed.
 */
function sameQueuedScriptJobs(
	left: readonly WorkspaceScriptQueuedJob[],
	right: readonly WorkspaceScriptQueuedJob[],
): boolean {
	return (
		left.length === right.length &&
		left.every((job, index) => {
			const other = right[index];
			return (
				other !== undefined &&
				job.id === other.id &&
				job.position === other.position &&
				job.initiator === other.initiator &&
				job.enqueuedAt === other.enqueuedAt &&
				job.kind === other.kind &&
				job.scriptName === other.scriptName
			);
		})
	);
}

/**
 * One workspace's setup and run script launches waiting in the compute queue,
 * first in line first. The queue broadcasts on every job change in every
 * workspace, so the selection keeps its previous reference until something this
 * workspace's dock shows has moved — a busy queue elsewhere costs the open
 * workspace no re-render.
 */
export const queuedScriptJobsAtomFamily = atomFamily((workspaceId: string) =>
	selectAtom(
		computeQueueSnapshotAtom,
		(snapshot) => selectQueuedScriptJobs(snapshot, workspaceId),
		sameQueuedScriptJobs,
	),
);
