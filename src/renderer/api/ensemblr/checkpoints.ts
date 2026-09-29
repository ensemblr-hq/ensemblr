import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	CheckpointsChangedBroadcast,
	ComputeTurnDiffResult,
	ListWorkspaceCheckpointsResult,
	RestoreCheckpointRequest,
	RestoreCheckpointResult,
} from '@/shared/ipc/contracts/checkpoint';

import {
	ensemblrQueryKeys,
	getEnsemblrApi,
	getEnsemblrApiOrNull,
} from './query-keys';

/**
 * Query options for every checkpoint captured in a workspace, oldest first,
 * each carrying where main resolved its turn to end. Backs both the chat
 * timelines' turn ranges and the Changes panel's "Latest turn" source; the
 * `checkpoints-changed` push keeps it current while a prompt is running.
 */
export function workspaceCheckpointsQuery(workspaceId: string | null) {
	return queryOptions({
		enabled: Boolean(workspaceId),
		queryFn: (): Promise<ListWorkspaceCheckpointsResult> =>
			profileElectronIpcCall(
				{ channel: 'ensemblr:list-workspace-checkpoints', usesDatabase: true },
				() =>
					getEnsemblrApi().listWorkspaceCheckpoints({
						workspaceId: workspaceId ?? '',
					}),
			),
		queryKey: ensemblrQueryKeys.checkpointsForWorkspace(workspaceId ?? ''),
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

/**
 * Subscribes to main's push after each checkpoint capture.
 * @param listener - Called with the workspace whose turn ranges moved
 * @returns Unsubscribe function; a no-op outside Electron
 */
export function subscribeCheckpointsChanged(
	listener: (broadcast: CheckpointsChangedBroadcast) => void,
): () => void {
	const api = getEnsemblrApiOrNull();
	if (!api) {
		return () => undefined;
	}
	return api.onCheckpointsChanged(listener);
}
