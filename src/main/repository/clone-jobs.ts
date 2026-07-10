import type { CloneGithubRepositoryPreparation } from '../../shared/ipc/contracts/clone';

/** Lifetime of a prepared-but-not-yet-started clone job. */
export const PREPARED_JOB_TTL_MS = 5 * 60 * 1000;

/** Internal: a prepared-but-not-yet-started clone job. */
interface PreparedJob {
	createdAtMs: number;
	preparation: CloneGithubRepositoryPreparation;
}

/** A bounded store of prepared clone jobs keyed by their `jobId`. */
interface PreparedJobStore {
	delete: (jobId: string) => void;
	evictExpired: () => void;
	get: (jobId: string) => PreparedJob | undefined;
	set: (jobId: string, preparation: CloneGithubRepositoryPreparation) => void;
}

/**
 * Creates a TTL-bounded map of prepared clone jobs. Eviction runs on demand
 * (callers invoke {@link PreparedJobStore.evictExpired} before reads) so the
 * store remains deterministic for tests.
 *
 * @param now - Clock seam.
 * @param ttlMs - Optional override for the TTL (defaults to
 *   {@link PREPARED_JOB_TTL_MS}).
 */
export function createPreparedJobStore(
	now: () => Date,
	ttlMs: number = PREPARED_JOB_TTL_MS,
): PreparedJobStore {
	const jobs = new Map<string, PreparedJob>();

	return {
		delete: (jobId) => {
			jobs.delete(jobId);
		},
		evictExpired: () => {
			evictExpiredJobs(jobs, now, ttlMs);
		},
		get: (jobId) => jobs.get(jobId),
		set: (jobId, preparation) => {
			jobs.set(jobId, {
				createdAtMs: now().getTime(),
				preparation,
			});
		},
	};
}

/** Drops prepared jobs whose TTL has elapsed; keeps the map size bounded. */
export function evictExpiredJobs(
	preparedJobs: Map<string, PreparedJob>,
	now: () => Date,
	ttlMs: number = PREPARED_JOB_TTL_MS,
): void {
	const nowMs = now().getTime();
	for (const [id, job] of preparedJobs) {
		if (nowMs - job.createdAtMs > ttlMs) {
			preparedJobs.delete(id);
		}
	}
}
