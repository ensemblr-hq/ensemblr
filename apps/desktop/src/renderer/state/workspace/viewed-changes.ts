import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { useCallback, useMemo } from 'react';

/**
 * Most marks one workspace keeps, oldest dropped first. A bound rather than a
 * change-set scan: the marks a workspace holds span every diff scope the
 * reviewer has looked at — the working tree, the whole branch, individual
 * commits — and no single surface knows the union of those change sets, so
 * pruning against any one of them would discard the others' marks.
 */
export const MAX_VIEWED_MARKS_PER_WORKSPACE = 1000;

/**
 * Persisted "viewed" marks for changed files, as `workspaceId → path → revision`.
 *
 * A mark stores the file's revision at the moment it was set rather than a bare
 * flag, so it expires by itself once the file changes again: an agent editing a
 * file the reviewer already signed off must not leave it dimmed and parked at the
 * bottom of the Changes list. `reviewFileRevision` builds that revision from the
 * file's content stamp, so any write to the file expires the mark.
 *
 * Marks are held per path rather than per path-and-scope so that signing a file
 * off under one change source carries to another showing the same diff of it,
 * which is the whole point of storing a revision instead of a flag.
 */
export const viewedChangesByWorkspaceAtom = atomWithStorage<
	Record<string, Record<string, string>>
>('ensemblr_workspace_viewed_changes_by_workspace', {}, undefined, {
	getOnInit: true,
});

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
 * A mark outlives the change set it was made against: it is dropped when the
 * workspace goes, when the reviewer unmarks it, or when the workspace passes
 * {@link MAX_VIEWED_MARKS_PER_WORKSPACE}. Nothing evicts it for leaving the
 * current source's change set — the same workspace is reviewed through several
 * diff scopes, and a path missing from one is routinely present in another.
 * @param workspaceId - Workspace the marks belong to
 * @returns Predicate and setter over that workspace's marks
 */
export function useViewedChanges(workspaceId: string): ViewedChangesState {
	const [viewedByWorkspace, setViewedByWorkspace] = useAtom(
		viewedChangesByWorkspaceAtom,
	);
	const marks = viewedByWorkspace[workspaceId];

	const isViewed = useCallback(
		(filePath: string, revision: string) => marks?.[filePath] === revision,
		[marks],
	);

	const setViewed = useCallback(
		(filePath: string, revision: string, viewed: boolean) => {
			setViewedByWorkspace((current) => ({
				...current,
				[workspaceId]: nextMarks({
					filePath,
					marks: current[workspaceId],
					revision,
					viewed,
				}),
			}));
		},
		[setViewedByWorkspace, workspaceId],
	);

	return useMemo(() => ({ isViewed, setViewed }), [isViewed, setViewed]);
}

/**
 * One workspace's marks after a single set-or-clear, trimmed to the storage
 * bound. The written path always survives the trim: it is re-appended last, so
 * the entries dropped are the ones marked longest ago.
 * @param input - The mark being written and the marks it is written into
 * @returns The workspace's replacement marks
 */
function nextMarks({
	filePath,
	marks,
	revision,
	viewed,
}: {
	filePath: string;
	marks: Record<string, string> | undefined;
	revision: string;
	viewed: boolean;
}): Record<string, string> {
	const others = Object.entries(marks ?? {}).filter(
		([path]) => path !== filePath,
	);
	if (!viewed) {
		return Object.fromEntries(others);
	}
	const retained = others.slice(1 - MAX_VIEWED_MARKS_PER_WORKSPACE);
	return { ...Object.fromEntries(retained), [filePath]: revision };
}
