import { ipcMain } from 'electron';

import type { ComputeQueueSnapshot } from '../../../shared/compute-queue';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	CancelComputeJobResult,
	StartComputeJobResult,
} from '../../../shared/ipc/contracts/compute-queue';
import type { ComputeQueueService } from '../../compute-queue/types.ts';
import {
	cancelComputeJobRequestSchema,
	startComputeJobRequestSchema,
} from '../request-schemas.ts';

/**
 * Registers the compute queue's renderer IPC surface: reading the current
 * snapshot, cancelling one job, and starting one queued job now. Cancel and
 * start validate strictly — a malformed payload throws — and the service
 * decides whether the job is still in a state the op applies to.
 * @param options - The queue service each op delegates to.
 */
export function registerComputeQueueHandlers({
	computeQueueService,
}: {
	computeQueueService: Pick<
		ComputeQueueService,
		'cancel' | 'snapshot' | 'startNow'
	>;
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
	ipcMain.handle(
		IPC_CHANNELS.startComputeJob,
		(_event, raw: unknown): StartComputeJobResult => {
			const { jobId } = startComputeJobRequestSchema.parse(raw);
			return { started: computeQueueService.startNow(jobId) };
		},
	);
}
