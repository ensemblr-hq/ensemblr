import type {
	FileTreeNode,
	ReviewFileSummary,
} from '@/renderer/types/workbench';

import { flattenFileTree } from './file-tree';

/** Which band of the conflict-split flat list a header introduces. */
export type ReviewGroupId = 'clean' | 'conflicts';

/** The change set split into the files that will not merge and the rest. */
export interface ReviewConflictGroups {
	clean: readonly ReviewFileSummary[];
	conflicted: readonly ReviewFileSummary[];
}

/** One row of the virtualized Changes list, whichever view mode produced it. */
export type ReviewListRow =
	| { group: ReviewGroupId; key: string; type: 'group' }
	| {
			ariaLevel?: number;
			ariaPosInSet?: number;
			ariaSetSize?: number;
			file: ReviewFileSummary;
			key: string;
			level: number;
			showPath: boolean;
			type: 'file';
	  }
	| {
			ariaPosInSet: number;
			ariaSetSize: number;
			isExpanded: boolean;
			key: string;
			labelParts: string[];
			level: number;
			path: string;
			type: 'directory';
	  };

/** File row height (h-8) plus the gap the unvirtualized list left below it. */
const FILE_ROW_SIZE = 36;

/** Folder row height (h-7) plus its gap. */
const DIRECTORY_ROW_SIZE = 32;

/** Group header line (text-xs), its top padding and the gap below it. */
const GROUP_ROW_SIZE = 24;

/**
 * Fixed pixel size of a row, so the virtualizer never has to measure. Each size
 * is the row's height plus the gap it sat above in the unvirtualized list.
 * @param row - The row to size
 * @returns Height in pixels the row's slot occupies
 */
export function reviewRowSize(row: ReviewListRow): number {
	switch (row.type) {
		case 'directory':
			return DIRECTORY_ROW_SIZE;
		case 'group':
			return GROUP_ROW_SIZE;
		case 'file':
			return FILE_ROW_SIZE;
	}
}

/**
 * Rows for the flat list: one row per file, or two labelled bands when conflicts
 * split it. A file keys on its id so a row that sinks after being marked viewed
 * moves its DOM node instead of remounting.
 * @param listedFiles - The files in the order the ungrouped list shows them
 * @param conflictGroups - The conflict split, or null when nothing conflicts
 * @returns Rows in render order; an empty band contributes no header
 */
export function buildReviewFlatRows(
	listedFiles: readonly ReviewFileSummary[],
	conflictGroups: ReviewConflictGroups | null,
): ReviewListRow[] {
	if (!conflictGroups) {
		return listedFiles.map(toFlatFileRow);
	}

	return [
		...buildGroupRows('conflicts', conflictGroups.conflicted),
		...buildGroupRows('clean', conflictGroups.clean),
	];
}

/**
 * Rows for the folder view, in the same order the recursive tree rendered them.
 * Keys carry the row kind, since a folder and a deleted file can share a path.
 * @param tree - Root of the changed-file tree
 * @param isExpanded - Whether a directory's compacted path is open
 * @returns Visible rows; a collapsed directory's subtree is skipped
 */
export function buildReviewTreeRows(
	tree: FileTreeNode<ReviewFileSummary>,
	isExpanded: (path: string) => boolean,
): ReviewListRow[] {
	return flattenFileTree(tree, isExpanded).map((row): ReviewListRow => {
		if (row.type === 'directory') {
			return {
				ariaPosInSet: row.posInSet,
				ariaSetSize: row.setSize,
				isExpanded: row.isExpanded,
				key: `directory:${row.key}`,
				labelParts: row.labelParts,
				level: row.level,
				path: row.node.path,
				type: 'directory',
			};
		}

		return {
			ariaLevel: row.level + 1,
			ariaPosInSet: row.posInSet,
			ariaSetSize: row.setSize,
			file: row.file,
			key: `file:${row.file.id}`,
			level: row.level,
			showPath: row.level === 0,
			type: 'file',
		};
	});
}

/**
 * A labelled band: its header followed by its files.
 * @param group - Which band this is
 * @param files - The band's files; none yields no rows at all
 * @returns Header plus file rows, or nothing for an empty band
 */
function buildGroupRows(
	group: ReviewGroupId,
	files: readonly ReviewFileSummary[],
): ReviewListRow[] {
	if (files.length === 0) {
		return [];
	}

	return [
		{ group, key: `group:${group}`, type: 'group' },
		...files.map(toFlatFileRow),
	];
}

/**
 * A flat-list file row: full path shown, no tree indent or ARIA level.
 * @param file - The changed file
 * @returns The row keyed on the file's id
 */
function toFlatFileRow(file: ReviewFileSummary): ReviewListRow {
	return { file, key: file.id, level: 0, showPath: true, type: 'file' };
}
