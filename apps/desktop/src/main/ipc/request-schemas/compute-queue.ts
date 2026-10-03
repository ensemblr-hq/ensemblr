import { z } from 'zod';

/** Validates the cancel request: a non-empty job id, strictly parsed. */
export const cancelComputeJobRequestSchema = z.object({
	jobId: z.string().min(1),
});
