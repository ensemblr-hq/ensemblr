import { useQuery } from '@tanstack/react-query';
import { useSetAtom } from 'jotai';
import { useEffect, useMemo } from 'react';

import {
	allWorkspacesHistoryQuery,
	isEnsemblrApiAvailable,
} from '@/renderer/api/ensemblr';
import { retainLastRunScripts } from '@/renderer/state/preferences';
import { pruneWorkspaceStateAtom } from '@/renderer/state/workspace';
import { retainLastUsedOpenTargets } from '@/renderer/state/workspace/open-target-history';

/**
 * Drops workspace-keyed renderer state — remembered chat tab, dock and review
 * tab, changes source, board placement, review marks, run script, "Open in…"
 * target — for workspaces that no longer exist. The delete path evicts these
 * itself, so this only clears what a delete could not reach: state stranded
 * before that eviction existed, by a removal performed in another window, or by
 * an archived workspace being purged from the Browse archive dialog.
 *
 * It reconciles against the History feed rather than the sidebar's project list
 * because that feed carries archived workspaces too. Archiving is reversible,
 * and a workspace that comes back has to come back with its board column, its
 * pin and its remembered tabs; the sidebar list would report every archived
 * workspace as gone and take all of that with it. That is also why this is not
 * folded into `useReconcileUnreadChats`, which shares the shape but retains
 * against the listed workspaces on purpose.
 *
 * An absent or empty feed is treated as "not loaded yet" rather than
 * "everything was deleted", so a first render before the query resolves cannot
 * wipe the install's preferences.
 */
export function useReconcileWorkspaceState(): void {
	const pruneWorkspaceState = useSetAtom(pruneWorkspaceStateAtom);
	const { data } = useQuery({
		...allWorkspacesHistoryQuery(),
		enabled: isEnsemblrApiAvailable(),
	});
	const entries = data?.entries;
	const existingWorkspaceIds = useMemo(
		() => new Set((entries ?? []).map((entry) => entry.id)),
		[entries],
	);

	useEffect(() => {
		if (existingWorkspaceIds.size === 0) {
			return;
		}
		pruneWorkspaceState(existingWorkspaceIds);
		retainLastUsedOpenTargets(existingWorkspaceIds);
		retainLastRunScripts(existingWorkspaceIds);
	}, [existingWorkspaceIds, pruneWorkspaceState]);
}
