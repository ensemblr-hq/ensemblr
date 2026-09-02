import { atom, getDefaultStore, useAtomValue, useSetAtom } from 'jotai';
import { selectAtom } from 'jotai/utils';
import { useMemo } from 'react';

/** Stable setters for marking a workspace's archive as running or finished. */
interface ArchivingWorkspaceActions {
	clearArchiving: (workspaceId: string) => void;
	markArchiving: (workspaceId: string) => void;
}

/**
 * Workspaces whose archive IPC is currently running.
 *
 * Deliberately not the navigation query cache: an archive outlives a snapshot
 * refetch, which would wipe an optimistic flag written onto the cached row and
 * leave the workspace looking idle halfway through. This is the visual mirror of
 * the run — the re-entrancy guard stays `lifecycle-run-latch.ts`, whose key is
 * released the moment the IPC answers, well before the row leaves the list.
 *
 * Kept out of the concern's barrel: every caller goes through the three
 * functions below, so the mark and the clear stay paired. Reach for the atom
 * itself only from this module and from a test that has to seed it.
 */
export const archivingWorkspaceIdsAtom = atom<ReadonlySet<string>>(
	new Set<string>(),
);

/**
 * Whether one workspace's archive is running, scoped so only that row
 * re-renders when the set changes.
 * @param workspaceId - Workspace to test
 * @returns True while the archive IPC for it is in flight
 */
export function useWorkspaceIsArchiving(workspaceId: string): boolean {
	const isArchivingAtom = useMemo(
		() =>
			selectAtom(archivingWorkspaceIdsAtom, (workspaceIds) =>
				workspaceIds.has(workspaceId),
			),
		[workspaceId],
	);
	return useAtomValue(isArchivingAtom);
}

/**
 * Returns the setters the archive action marks its run with.
 * @returns Stable callbacks to mark and clear one workspace
 */
export function useArchivingWorkspaceActions(): ArchivingWorkspaceActions {
	const setArchivingWorkspaceIds = useSetAtom(archivingWorkspaceIdsAtom);

	return useMemo(
		() => ({
			clearArchiving: (workspaceId: string) => {
				setArchivingWorkspaceIds((current) => {
					if (!current.has(workspaceId)) {
						return current;
					}
					const next = new Set(current);
					next.delete(workspaceId);
					return next;
				});
			},
			markArchiving: (workspaceId: string) => {
				setArchivingWorkspaceIds((current) =>
					current.has(workspaceId)
						? current
						: new Set(current).add(workspaceId),
				);
			},
		}),
		[setArchivingWorkspaceIds],
	);
}

/**
 * Reads the archiving set outside React, for the route loaders that have to
 * refuse an archiving workspace as a navigation target.
 * @returns The workspace ids whose archive is running
 */
export function getArchivingWorkspaceIds(): ReadonlySet<string> {
	return getDefaultStore().get(archivingWorkspaceIdsAtom);
}
