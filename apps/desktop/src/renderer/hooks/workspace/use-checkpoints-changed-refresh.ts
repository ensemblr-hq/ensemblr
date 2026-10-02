import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
	ensemblrQueryKeys,
	subscribeCheckpointsChanged,
} from '@/renderer/api/ensemblr-queries';

/**
 * Re-reads a workspace's turn ranges whenever main captures a checkpoint in it.
 *
 * A capture is what closes the turn before it, and it lands as a prompt starts,
 * long before that prompt settles. Waiting for the settle left the previous turn
 * reading as the newest for the whole of the next one, diffing the live tree
 * the next turn was writing to and listing its files as its own.
 * @param workspaceId - Workspace whose checkpoint list to keep current; empty is a no-op
 */
export function useCheckpointsChangedRefresh(workspaceId: string): void {
	const queryClient = useQueryClient();
	useEffect(() => {
		if (workspaceId.length === 0) {
			return undefined;
		}
		return subscribeCheckpointsChanged((broadcast) => {
			if (broadcast.workspaceId !== workspaceId) {
				return;
			}
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.checkpointsForWorkspace(workspaceId),
			});
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.turnDiffAll(),
			});
		});
	}, [queryClient, workspaceId]);
}
