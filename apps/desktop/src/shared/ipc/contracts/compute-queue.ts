import type { ComputeQueueSnapshot } from '../../compute-queue';

/** Broadcast from main whenever a job is queued, started, finished, or cancelled. */
export interface ComputeQueueChangedBroadcast {
	snapshot: ComputeQueueSnapshot;
}

/** Cancels one queued or running compute job. */
export interface CancelComputeJobRequest {
	jobId: string;
}

/** Whether the job was still live and has now been cancelled. */
export interface CancelComputeJobResult {
	cancelled: boolean;
}

/** Renderer-facing surface of the app-wide compute queue. */
export interface ComputeQueueApi {
	cancelComputeJob: (
		request: CancelComputeJobRequest,
	) => Promise<CancelComputeJobResult>;
	getComputeQueueSnapshot: () => Promise<ComputeQueueSnapshot>;
	onComputeQueueChanged: (
		listener: (event: ComputeQueueChangedBroadcast) => void,
	) => () => void;
}
