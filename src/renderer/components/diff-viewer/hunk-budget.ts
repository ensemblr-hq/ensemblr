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

/**
 * How many diff rows the whole-turn surface lays out across every file before
 * it offers the remaining files behind a control.
 *
 * {@link MAX_RENDERED_DIFF_ROWS} bounds one viewer, but a turn mounts one viewer
 * per changed file, so a few hundred modest files add up to the same
 * six-figure node count. Three files' worth keeps an ordinary turn whole while
 * the layout cost of one commit stays a small multiple of a single big file's.
 */
export const MAX_RENDERED_TURN_DIFF_ROWS = 3 * MAX_RENDERED_DIFF_ROWS;

/** A hunk list trimmed to the row budget, with what the trim left out. */
export interface BoundedHunks {
	hiddenHunks: number;
	hiddenRows: number;
	hunks: HunkData[];
}

/**
 * Trims a file's hunks to the row budget, keeping whole hunks so no hunk ever
 * renders half its changes — except a first hunk longer than the budget itself.
 *
 * That one is cut to the budget rather than kept whole: a new file, a lockfile
 * or a generated bundle arrives as a single hunk of tens of thousands of lines,
 * and keeping it whole made the budget a no-op for exactly the diffs it exists
 * for. Cutting it, rather than dropping it, keeps the rule that a viewer never
 * renders an empty diff.
 * @param hunks - The file's hunks, in document order
 * @param budget - How many rows may be laid out
 * @returns The hunks to render and the size of what was withheld
 */
export function boundHunksToRowBudget(
	hunks: HunkData[],
	budget: number = MAX_RENDERED_DIFF_ROWS,
): BoundedHunks {
	const shown: HunkData[] = [];
	let shownRows = 0;
	for (const hunk of hunks) {
		const remaining = budget - shownRows;
		if (hunk.changes.length <= remaining) {
			shown.push(hunk);
			shownRows += hunk.changes.length;
			continue;
		}
		if (shown.length === 0) {
			shown.push({ ...hunk, changes: hunk.changes.slice(0, remaining) });
			shownRows = remaining;
		}
		break;
	}
	const totalRows = hunks.reduce((rows, hunk) => rows + hunk.changes.length, 0);
	if (shownRows === totalRows) {
		return { hiddenHunks: 0, hiddenRows: 0, hunks };
	}
	return {
		hiddenHunks: hunks.length - shown.length,
		hiddenRows: totalRows - shownRows,
		hunks: shown,
	};
}

/**
 * Counts the lines of a patch, stopping once it reaches `cap`, so measuring a
 * patch that is about to be trimmed anyway does not read all of it.
 * @param patch - The patch text
 * @param cap - The line count past which the exact figure no longer matters
 * @returns The number of lines, at most `cap`
 */
function cappedLineCount(patch: string, cap: number): number {
	let lines = 0;
	let from = 0;
	while (lines < cap) {
		const end = patch.indexOf('\n', from);
		if (end === -1) {
			return patch.length > from ? lines + 1 : lines;
		}
		lines += 1;
		from = end + 1;
	}
	return cap;
}

/**
 * How many of a turn's leading file patches fit a row budget, so the
 * whole-turn surface can mount those and hold the rest behind a control.
 *
 * Each patch costs its line count, at most {@link MAX_RENDERED_DIFF_ROWS}: its
 * own viewer trims itself past that, so one huge file cannot spend the whole
 * budget and push every file after it out. The first patch is always counted,
 * however long, so a turn never opens on an empty diff; after it the count
 * stops at the first patch that would overrun, keeping files in document order.
 * @param patches - Each changed file's patch text, in document order
 * @param budget - How many rows may be laid out across all of them
 * @returns How many leading patches to lay out
 */
export function countPatchesWithinRowBudget(
	patches: readonly string[],
	budget: number,
): number {
	let rows = 0;
	let count = 0;
	for (const patch of patches) {
		rows += cappedLineCount(patch, MAX_RENDERED_DIFF_ROWS);
		if (count > 0 && rows > budget) {
			break;
		}
		count += 1;
	}
	return count;
}
