import { ipcMain } from 'electron';

import type { ComputeQueueSnapshot } from '../../../shared/compute-queue';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type { CancelComputeJobResult } from '../../../shared/ipc/contracts/compute-queue';
import type { ComputeQueueService } from '../../compute-queue/types.ts';
import { cancelComputeJobRequestSchema } from '../request-schemas.ts';

/**
 * Registers the compute queue's renderer IPC surface: reading the current
 * snapshot and cancelling one job. Cancel validates strictly — a malformed
 * payload throws — and the service decides whether the job is still live.
 * @param options - The queue service each op delegates to.
 */
export function registerComputeQueueHandlers({
	computeQueueService,
}: {
	computeQueueService: Pick<ComputeQueueService, 'cancel' | 'snapshot'>;
}): void {
	ipcMain.handle(
		IPC_CHANNELS.getComputeQueueSnapshot,
		(): ComputeQueueSnapshot => computeQueueService.snapshot(),
	);
	ipcMain.handle(
		IPC_CHANNELS.cancelComputeJob,
		(_event, raw: unknown): CancelComputeJobResult => {
			const { jobId } = cancelComputeJobRequestSchema.parse(raw);
			return { cancelled: computeQueueService.cancel(jobId) };
		},
	);
}
