import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type { ComputeQueueSnapshot } from '@/shared/compute-queue';
import type {
	CancelComputeJobResult,
	ComputeQueueChangedBroadcast,
} from '@/shared/ipc/contracts/compute-queue';

import { getEnsemblrApi, getEnsemblrApiOrNull } from './query-keys';

/** Subscribes to queue changes pushed by main; returns an unsubscribe fn. */
export function subscribeComputeQueueChanged(
	listener: (event: ComputeQueueChangedBroadcast) => void,
): () => void {
	const api = getEnsemblrApiOrNull();
	return api ? api.onComputeQueueChanged(listener) : () => undefined;
}

/** Reads the queue's current state, for the first render before any broadcast. */
export function readComputeQueueSnapshot(): Promise<ComputeQueueSnapshot> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:get-compute-queue-snapshot', usesDatabase: false },
		() => getEnsemblrApi().getComputeQueueSnapshot(),
	);
}

/** Cancels one queued or running job; resolves false when it was no longer live. */
export function cancelComputeJob(
	jobId: string,
): Promise<CancelComputeJobResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:cancel-compute-job', usesDatabase: false },
		() => getEnsemblrApi().cancelComputeJob({ jobId }),
	);
}
