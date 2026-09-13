import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { workspaceCheckpointsQuery } from '@/renderer/api/ensemblr';
import { latestTurnCheckpointScope } from '@/renderer/lib/workbench';
import type { WorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';

/**
 * The workspace's newest agent turn, resolved from its checkpoints.
 *
 * `scope` is null both while the list is in flight and when the workspace has
 * never run a turn, so callers must read `isPending`/`isError` rather than
 * treating a null scope as "no changes" — the two need opposite handling.
 */
export interface LatestTurnScope {
	isError: boolean;
	isPending: boolean;
	/** Prompt summary of the newest turn, for the menu row and badge tooltip. */
	label: string | null;
	scope: Extract<WorkspaceGitDiffScope, { kind: 'turn' }> | null;
}

/**
 * Resolves the diff scope covering what the workspace's newest agent turn
 * changed. The Changes panel is workspace-scoped rather than chat-scoped, so
 * "the latest turn" is the newest checkpoint here whichever chat produced it.
 * @param workspaceId - Workspace whose checkpoints to read
 * @param enabled - False until something actually needs the answer, since the
 *   read is pointless for a workspace the user merely has open
 * @returns The latest turn's scope and label, plus the read's own state
 */
export function useLatestTurnScope(
	workspaceId: string,
	enabled: boolean,
): LatestTurnScope {
	const { data, isError, isPending } = useQuery({
		...workspaceCheckpointsQuery(workspaceId),
		enabled,
	});

	const latest = useMemo(
		() => (data ? latestTurnCheckpointScope(data.checkpoints) : null),
		[data],
	);

	return {
		isError,
		// A disabled query reports `isPending` forever, which would read as a
		// permanently loading turn to anyone who did not ask for one.
		isPending: enabled && isPending,
		label: latest?.label ?? null,
		scope: latest?.scope ?? null,
	};
}
