import { atom, getDefaultStore, useAtomValue, useSetAtom } from 'jotai';
import { selectAtom } from 'jotai/utils';
import { useMemo } from 'react';

import type { WorkspaceLifecycleRun } from '@/renderer/types/components';

/** Stable setters for marking a workspace's lifecycle run as started or finished. */
interface WorkspaceLifecycleRunActions {
	clearLifecycleRun: (workspaceId: string) => void;
	markLifecycleRun: (workspaceId: string, run: WorkspaceLifecycleRun) => void;
}

/**
 * Workspaces whose archive or delete IPC is currently running, and which one.
 *
 * Deliberately not the navigation query cache: a teardown outlives a snapshot
 * refetch, which would wipe an optimistic flag written onto the cached row and
 * leave the workspace looking idle halfway through. This is the visual mirror of
 * the run — the re-entrancy guard stays `lifecycle-run-latch.ts`, whose key is
 * released the moment the IPC answers, well before the row leaves the list.
 *
 * Kept out of the concern's barrel: every caller goes through the three
 * functions below, so the mark and the clear stay paired. Reach for the atom
 * itself only from this module and from a test that has to seed it.
 */
export const workspaceLifecycleRunsAtom = atom<
	ReadonlyMap<string, WorkspaceLifecycleRun>
>(new Map<string, WorkspaceLifecycleRun>());

/**
 * Which destructive run is holding one workspace, scoped so only that row
 * re-renders when the map changes.
 * @param workspaceId - Workspace to test
 * @returns The run in flight for it, or null when there is none
 */
export function useWorkspaceLifecycleRun(
	workspaceId: string,
): WorkspaceLifecycleRun | null {
	const lifecycleRunAtom = useMemo(
		() =>
			selectAtom(
				workspaceLifecycleRunsAtom,
				(runs) => runs.get(workspaceId) ?? null,
			),
		[workspaceId],
	);
	return useAtomValue(lifecycleRunAtom);
}

/**
 * Returns the setters an archive or delete action marks its run with.
 * @returns Stable callbacks to mark and clear one workspace
 */
export function useWorkspaceLifecycleRunActions(): WorkspaceLifecycleRunActions {
	const setLifecycleRuns = useSetAtom(workspaceLifecycleRunsAtom);

	return useMemo(
		() => ({
			clearLifecycleRun: (workspaceId: string) => {
				setLifecycleRuns((current) => {
					if (!current.has(workspaceId)) {
						return current;
					}
					const next = new Map(current);
					next.delete(workspaceId);
					return next;
				});
			},
			markLifecycleRun: (workspaceId: string, run: WorkspaceLifecycleRun) => {
				setLifecycleRuns((current) =>
					current.get(workspaceId) === run
						? current
						: new Map(current).set(workspaceId, run),
				);
			},
		}),
		[setLifecycleRuns],
	);
}

/**
 * Reads the workspaces under a destructive run outside React, for the route
 * loaders that have to refuse one as a navigation target.
 * @returns The workspace ids whose archive or delete is running
 */
export function getUnavailableWorkspaceIds(): ReadonlySet<string> {
	return new Set(getDefaultStore().get(workspaceLifecycleRunsAtom).keys());
}
