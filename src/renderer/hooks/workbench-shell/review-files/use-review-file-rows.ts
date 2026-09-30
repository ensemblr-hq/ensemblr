import { useMemo } from 'react';

import { useFileTreeExpansion } from '@/renderer/hooks/workbench-shell/review-files/use-file-tree-expansion';
import {
	buildFileTree,
	listDirectoryPaths,
} from '@/renderer/lib/workbench/file-tree';
import {
	buildReviewFlatRows,
	buildReviewTreeRows,
	type ReviewConflictGroups,
	type ReviewListRow,
} from '@/renderer/lib/workbench/review-file-rows';
import type { ReviewFileSummary } from '@/renderer/types/workbench';
import type { ChangesViewMode } from '@/renderer/types/workbench-shell';

const NO_FILES: readonly ReviewFileSummary[] = [];

/**
 * Turns the change set into the single row list the virtualized Changes panel
 * renders: the folder tree flattened to its visible rows in folders mode, the
 * flat (optionally conflict-split) list otherwise. Owns the folder expansion
 * state, so the tree is only built while it is on screen.
 * @param conflictGroups - The conflict split of the flat list, or null when nothing conflicts
 * @param listedFiles - Files in the order the ungrouped flat list shows them
 * @param markedFiles - Files in natural order, the folder tree's input
 * @param viewMode - Whether the panel shows the flat list or the folder tree
 * @returns The rows to render and a toggle whose identity never changes
 */
export function useReviewFileRows({
	conflictGroups,
	listedFiles,
	markedFiles,
	viewMode,
}: {
	conflictGroups: ReviewConflictGroups | null;
	listedFiles: readonly ReviewFileSummary[];
	markedFiles: readonly ReviewFileSummary[];
	viewMode: ChangesViewMode;
}): { rows: ReviewListRow[]; toggleDirectory: (path: string) => void } {
	const isFolders = viewMode === 'folders';
	const tree = useMemo(
		() => buildFileTree(isFolders ? markedFiles : NO_FILES),
		[isFolders, markedFiles],
	);
	const knownDirectoryPaths = useMemo(() => listDirectoryPaths(tree), [tree]);
	// Folders start expanded: the changes set is small, and reviewers want to
	// see every touched file at a glance.
	const { isExpanded, toggleDirectory } = useFileTreeExpansion(
		true,
		knownDirectoryPaths,
	);

	const rows = useMemo(
		() =>
			isFolders
				? buildReviewTreeRows(tree, isExpanded)
				: buildReviewFlatRows(listedFiles, conflictGroups),
		[conflictGroups, isExpanded, isFolders, listedFiles, tree],
	);

	return { rows, toggleDirectory };
}
