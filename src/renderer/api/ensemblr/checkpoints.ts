import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	ComputeTurnDiffResult,
	ListTurnCheckpointsResult,
	RestoreCheckpointRequest,
	RestoreCheckpointResult,
} from '@/shared/ipc/contracts/checkpoint';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

/** Query options for the checkpoints captured across a Pi session's turns. */
export function turnCheckpointsQuery(piSessionId: string | null) {
	return queryOptions({
		enabled: Boolean(piSessionId),
		queryFn: (): Promise<ListTurnCheckpointsResult> =>
			profileElectronIpcCall(
				{ channel: 'ensemblr:list-turn-checkpoints', usesDatabase: true },
				() =>
					getEnsemblrApi().listTurnCheckpoints({
						piSessionId: piSessionId ?? '',
					}),
			),
		queryKey: ensemblrQueryKeys.checkpointsForSession(piSessionId ?? ''),
		staleTime: 5000,
	});
}

/** Query options for a turn's checkpoint diff (pre-prompt → post-turn state). */
export function turnDiffQuery(turnId: string | null) {
	return queryOptions({
		enabled: Boolean(turnId),
		queryFn: (): Promise<ComputeTurnDiffResult> =>
			profileElectronIpcCall(
				{ channel: 'ensemblr:compute-turn-diff', usesDatabase: true },
				() => getEnsemblrApi().computeTurnDiff({ turnId: turnId ?? '' }),
			),
		queryKey: ensemblrQueryKeys.turnDiff(turnId ?? ''),
		staleTime: 5000,
	});
}

/** Restores workspace files to a turn's pre-prompt checkpoint. */
export function restoreCheckpoint(
	request: RestoreCheckpointRequest,
): Promise<RestoreCheckpointResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:restore-checkpoint', usesDatabase: true },
		() => getEnsemblrApi().restoreCheckpoint(request),
	);
}
