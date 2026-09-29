import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { workspaceCheckpointsQuery } from '@/renderer/api/ensemblr-queries';
import { useCheckpointsChangedRefresh } from '@/renderer/hooks/workspace/use-checkpoints-changed-refresh';
import { currentTurnScope } from '@/renderer/lib/workbench';
import type { WorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';

/**
 * The scope a diff tab should read now. A tab keeps the turn scope it opened
 * with, which can go stale: a turn opened while running stored the live tree,
 * and one opened while Claude paused between queued inputs stored an end the
 * turn later moved past. This swaps in the turn's current end, so the tab
 * never shows another turn's edits under this turn's name. Every other scope
 * passes through, and only a turn scope reads the checkpoint list at all.
 * @param scope - The scope the tab was opened with
 * @param workspaceId - Workspace the tab belongs to
 * @returns The scope to diff at, or null when the turn's range was lost
 */
export function useCurrentTurnScope({
	scope,
	workspaceId,
}: {
	scope: WorkspaceGitDiffScope | undefined;
	workspaceId: string;
}): WorkspaceGitDiffScope | undefined | null {
	const isTurn = scope?.kind === 'turn';
	const { data } = useQuery({
		...workspaceCheckpointsQuery(workspaceId),
		enabled: isTurn && workspaceId.length > 0,
	});
	useCheckpointsChangedRefresh(isTurn ? workspaceId : '');
	return useMemo(
		() => currentTurnScope(scope, data?.checkpoints ?? []),
		[data?.checkpoints, scope],
	);
}
