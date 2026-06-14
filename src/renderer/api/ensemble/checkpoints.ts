import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type { ComputeTurnDiffResult, ListTurnCheckpointsResult, RestoreCheckpointRequest, RestoreCheckpointResult } from '@/shared/ipc/contracts/checkpoint';

import { ensembleQueryKeys, getEnsembleApi } from './query-keys';

/** Query options for the checkpoints captured across a Pi session's turns. */
export function turnCheckpointsQuery(piSessionId: string | null) {
	return queryOptions({
		enabled: Boolean(piSessionId),
		queryFn: (): Promise<ListTurnCheckpointsResult> =>
			profileElectronIpcCall(
				{ channel: 'ensemble:list-turn-checkpoints', usesDatabase: true },
				() =>
					getEnsembleApi().listTurnCheckpoints({
						piSessionId: piSessionId ?? '',
					}),
			),
		queryKey: ensembleQueryKeys.checkpointsForSession(piSessionId ?? ''),
		staleTime: 5000,
	});
}

/** Query options for a turn's checkpoint diff (pre-prompt → post-turn state). */
export function turnDiffQuery(turnId: string | null) {
	return queryOptions({
		enabled: Boolean(turnId),
		queryFn: (): Promise<ComputeTurnDiffResult> =>
			profileElectronIpcCall(
				{ channel: 'ensemble:compute-turn-diff', usesDatabase: true },
				() => getEnsembleApi().computeTurnDiff({ turnId: turnId ?? '' }),
			),
		queryKey: ensembleQueryKeys.turnDiff(turnId ?? ''),
		staleTime: 5000,
	});
}

/** Restores workspace files to a turn's pre-prompt checkpoint. */
export function restoreCheckpoint(
	request: RestoreCheckpointRequest,
): Promise<RestoreCheckpointResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:restore-checkpoint', usesDatabase: true },
		() => getEnsembleApi().restoreCheckpoint(request),
	);
}
