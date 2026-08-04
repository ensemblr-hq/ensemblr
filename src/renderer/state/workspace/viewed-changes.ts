import { atom, useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { useCallback, useMemo } from 'react';

/**
 * Persisted "viewed" marks for changed files, as `workspaceId → path → revision`.
 *
 * A mark stores the file's revision at the moment it was set rather than a bare
 * flag, so it expires by itself once the file changes again: an agent editing a
 * file the reviewer already signed off must not leave it dimmed and parked at the
 * bottom of the Changes list. `reviewFileRevision` builds that revision from the
 * file's content stamp, so any write to the file expires the mark.
 */
export const viewedChangesByWorkspaceAtom = atomWithStorage<
	Record<string, Record<string, string>>
>('ensemblr_workspace_viewed_changes_by_workspace', {}, undefined, {
	getOnInit: true,
});

/**
 * Drops every mark held for one workspace. Call when a workspace is deleted or
 * archived — nothing else evicts a workspace's marks, and the map is persisted,
 * so without this it keeps them for the lifetime of the install.
 */
export const forgetWorkspaceViewedChangesAtom = atom(
	null,
	(_get, set, workspaceId: string) => {
		set(viewedChangesByWorkspaceAtom, (current) =>
			workspaceId in current ? omitKey(current, workspaceId) : current,
		);
	},
);

/** Reading and writing one workspace's "viewed" marks. */
export interface ViewedChangesState {
	/** Whether the file is marked viewed at the revision it is being shown at. */
	isViewed: (filePath: string, revision: string) => boolean;
	setViewed: (filePath: string, revision: string, viewed: boolean) => void;
}

/**
 * The viewed-mark surface for one workspace, shared by the Changes list and the
 * diff toolbar so both agree on what has been signed off.
 *
 * Writing also prunes: a path that has left `changedPaths` — committed,
 * discarded, or reverted — can never be shown again at the revision its mark was
 * set at, so keeping it only grows the persisted map. Every write trims the
 * workspace down to the change set the caller can see, which keeps storage
 * bounded without a scan of its own.
 * @param workspaceId - Workspace the marks belong to
 * @param changedPaths - Paths currently in the change set; omit where the caller only reads
 * @returns Predicate and setter over that workspace's marks
 */
export function useViewedChanges(
	workspaceId: string,
	changedPaths?: readonly string[],
): ViewedChangesState {
	const [viewedByWorkspace, setViewedByWorkspace] = useAtom(
		viewedChangesByWorkspaceAtom,
	);
	const marks = viewedByWorkspace[workspaceId];
	const changedPathKey = changedPaths?.join('\n');

	const isViewed = useCallback(
		(filePath: string, revision: string) => marks?.[filePath] === revision,
		[marks],
	);

	const setViewed = useCallback(
		(filePath: string, revision: string, viewed: boolean) => {
			const retained =
				changedPathKey === undefined
					? null
					: new Set(changedPathKey ? changedPathKey.split('\n') : []);
			setViewedByWorkspace((current) => ({
				...current,
				[workspaceId]: nextMarks({
					filePath,
					marks: current[workspaceId],
					retained,
					revision,
					viewed,
				}),
			}));
		},
		[changedPathKey, setViewedByWorkspace, workspaceId],
	);

	return useMemo(() => ({ isViewed, setViewed }), [isViewed, setViewed]);
}

/**
 * One workspace's marks after a single set-or-clear, with any path outside
 * `retained` dropped.
 * @param input - The mark being written, the marks it is written into, and the paths worth keeping
 * @returns The workspace's replacement marks
 */
function nextMarks({
	filePath,
	marks,
	retained,
	revision,
	viewed,
}: {
	filePath: string;
	marks: Record<string, string> | undefined;
	retained: ReadonlySet<string> | null;
	revision: string;
	viewed: boolean;
}): Record<string, string> {
	const kept = Object.fromEntries(
		Object.entries(marks ?? {}).filter(
			([path]) => path !== filePath && (!retained || retained.has(path)),
		),
	);
	return viewed ? { ...kept, [filePath]: revision } : kept;
}

/**
 * Copy of a record without one key.
 * @param record - The record to copy
 * @param key - Key to leave out
 * @returns A new record holding every other entry
 */
function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
	return Object.fromEntries(
		Object.entries(record).filter(([entryKey]) => entryKey !== key),
	);
}
