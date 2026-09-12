import type { HunkData } from 'react-diff-view';

/**
 * How many diff rows the viewer lays out before it stops and offers the rest
 * behind a control.
 *
 * `react-diff-view` emits a table row per change line and one `<span>` per
 * syntax token inside it, so a 5,000-line diff is on the order of 50,000 DOM
 * nodes for a single file — laid out synchronously, in one commit, after the
 * tokenizer has already finished. Two thousand rows is the point where the
 * layout still lands inside a frame budget a reader would not notice.
 */
export const MAX_RENDERED_DIFF_ROWS = 2_000;

/** A hunk list trimmed to the row budget, with what the trim left out. */
export interface BoundedHunks {
	hiddenHunks: number;
	hiddenRows: number;
	hunks: HunkData[];
}

/**
 * Trims a file's hunks to the row budget, keeping whole hunks so no hunk ever
 * renders half its changes.
 *
 * The first hunk is always kept, however long it is: a file whose single hunk
 * exceeds the budget on its own would otherwise render as an empty diff, and a
 * viewer that shows nothing is worse than one that shows a slow first screen.
 * @param hunks - The file's hunks, in document order
 * @param budget - How many rows may be laid out
 * @returns The hunks to render and the size of what was withheld
 */
export function boundHunksToRowBudget(
	hunks: HunkData[],
	budget: number = MAX_RENDERED_DIFF_ROWS,
): BoundedHunks {
	let rows = 0;
	let kept = 0;
	for (const hunk of hunks) {
		const next = rows + hunk.changes.length;
		if (kept > 0 && next > budget) {
			break;
		}
		rows = next;
		kept += 1;
	}
	if (kept === hunks.length) {
		return { hiddenHunks: 0, hiddenRows: 0, hunks };
	}
	let hiddenRows = 0;
	for (let index = kept; index < hunks.length; index += 1) {
		hiddenRows += hunks[index]?.changes.length ?? 0;
	}
	return {
		hiddenHunks: hunks.length - kept,
		hiddenRows,
		hunks: hunks.slice(0, kept),
	};
}
