import { isComputeJobFinished } from '../../shared/compute-queue.ts';
import type {
	ComputeJobResult,
	WaitForJobsOptions,
	WaitForJobsResult,
} from './types.ts';

/** Reads a job's current result; null once it is unknown or expired. */
type ResultReader = (jobId: string) => ComputeJobResult | null;

/** One outstanding wait: re-evaluated on every queue change. */
interface Waiter {
	/** Settles the wait when every job has finished; returns true once settled. */
	check: (read: ResultReader) => boolean;
}

/** The set of pending `waitFor` calls the queue wakes on each state change. */
export interface JobWaiters {
	/** Starts a wait over known job ids. */
	add: (
		jobIds: readonly string[],
		options: WaitForJobsOptions,
		read: ResultReader,
	) => Promise<WaitForJobsResult>;
	/** Re-checks every pending wait against the current job states. */
	check: (read: ResultReader) => void;
}

/**
 * Splits the named jobs into finished and unfinished results.
 * @param jobIds - Jobs being waited on.
 * @param read - Result reader.
 * @returns The settled and pending results; expired jobs are dropped.
 */
function partition(
	jobIds: readonly string[],
	read: ResultReader,
): { pending: ComputeJobResult[]; settled: ComputeJobResult[] } {
	const results = jobIds
		.map(read)
		.filter((result): result is ComputeJobResult => result !== null);

	return {
		pending: results.filter((result) => !isComputeJobFinished(result.state)),
		settled: results.filter((result) => isComputeJobFinished(result.state)),
	};
}

/**
 * Builds the promise-driven wait registry: a wait settles on the queue change
 * that finishes its last job, at its timeout, or when its signal aborts — no
 * polling loop.
 * @returns The registry.
 */
export function createJobWaiters(): JobWaiters {
	const waiters = new Set<Waiter>();

	return {
		add: (jobIds, { signal, timeoutMs }, read) =>
			new Promise<WaitForJobsResult>((resolve) => {
				const ids = Array.from(new Set(jobIds));
				let timer: ReturnType<typeof setTimeout> | null = null;

				/**
				 * Resolves with the current split and tears the wait down.
				 * @param timedOut - Whether the timeout is what ended the wait.
				 * @param current - Reader to take the final split from.
				 */
				const settle = (timedOut: boolean, current: ResultReader): void => {
					waiters.delete(waiter);
					if (timer !== null) {
						clearTimeout(timer);
					}
					signal?.removeEventListener('abort', onAbort);
					resolve({ ...partition(ids, current), timedOut });
				};

				/** Ends the wait early with whatever state the jobs are in. */
				const onAbort = (): void => settle(false, read);

				const waiter: Waiter = {
					check: (current) => {
						if (partition(ids, current).pending.length > 0) {
							return false;
						}
						settle(false, current);
						return true;
					},
				};

				if (waiter.check(read)) {
					return;
				}
				if (signal?.aborted) {
					settle(false, read);
					return;
				}
				waiters.add(waiter);
				signal?.addEventListener('abort', onAbort, { once: true });
				timer = setTimeout(() => settle(true, read), Math.max(0, timeoutMs));
			}),
		check: (read) => {
			for (const waiter of Array.from(waiters)) {
				waiter.check(read);
			}
		},
	};
}
