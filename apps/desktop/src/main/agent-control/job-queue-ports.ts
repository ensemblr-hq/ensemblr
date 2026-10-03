/**
 * The port agent control reaches the app-wide compute queue through: the slice
 * of the queue's own contract the three queue ops and the heavy-command gates
 * need, plus a live read of the queue's settings, which decide whether a shell
 * command is heavy at all.
 */
import type { ComputeQueueSettings } from '../../shared/config.ts';
import type { ComputeQueueService } from '../compute-queue/index.ts';

/** The compute queue as agent control sees it. */
export type JobQueuePort = Pick<
	ComputeQueueService,
	| 'cancel'
	| 'enqueueCommand'
	| 'getJob'
	| 'listJobs'
	| 'releaseSession'
	| 'waitFor'
> & {
	/** Reads the compute-queue settings at call time, so a change applies to the next command. */
	readSettings: () => ComputeQueueSettings;
};

/**
 * Builds the job-queue port over the queue service and the settings reader.
 * @param queue - The app-wide compute queue.
 * @param readSettings - Reads the live compute-queue settings.
 * @returns The port the agent-control service composes.
 */
export function createJobQueuePort(
	queue: ComputeQueueService,
	readSettings: () => ComputeQueueSettings,
): JobQueuePort {
	return {
		cancel: (jobId) => queue.cancel(jobId),
		enqueueCommand: (request) => queue.enqueueCommand(request),
		getJob: (jobId) => queue.getJob(jobId),
		listJobs: (filter) => queue.listJobs(filter),
		readSettings,
		releaseSession: (sessionId) => queue.releaseSession(sessionId),
		waitFor: (jobIds, options) => queue.waitFor(jobIds, options),
	};
}
