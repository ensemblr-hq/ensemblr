import {
	type ChangeData,
	type FileData,
	type HunkData,
	isDelete,
	isInsert,
	isNormal,
	parseDiff,
} from 'react-diff-view';

export type { ChangeData, FileData, HunkData };

/** Most recent patch parses, capped so long sessions don't grow the cache without bound. */
const PARSE_CACHE_LIMIT = 32;
const parseCache = new Map<string, FileData | null>();

/**
 * Parse a single-file unified patch into the react-diff-view file model, cached
 * by patch text so the diff surface and its comment grouper (which parse the
 * same patch independently) share one parse. Safe to share: react-diff-view's
 * `tokenize`/`markEdits`/`expandFromRawCode` read hunks without mutating them.
 * @param patch - Raw unified-diff text for one file
 * @returns The parsed file, or null when the patch is empty or unparseable
 */
export function parseSingleFileDiff(patch: string): FileData | null {
	if (!patch.trim()) {
		return null;
	}
	const cached = parseCache.get(patch);
	if (cached !== undefined) {
		return cached;
	}
	let file: FileData | null;
	try {
		file = parseDiff(patch).at(0) ?? null;
	} catch {
		file = null;
	}
	if (parseCache.size >= PARSE_CACHE_LIMIT) {
		const oldest = parseCache.keys().next().value;
		if (oldest !== undefined) {
			parseCache.delete(oldest);
		}
	}
	parseCache.set(patch, file);
	return file;
}

/** One file's slice of a combined multi-file unified patch. */
export interface PatchFile {
	patch: string;
	path: string;
}

/**
 * Split a combined multi-file unified patch into per-file patches, keyed by the
 * new path from each `diff --git` header. Used to render one diff surface per
 * file from a single combined checkpoint patch.
 * @param combined - A unified patch that may span multiple files
 * @returns The per-file patch slices, in document order
 */
export function splitCombinedPatch(combined: string): PatchFile[] {
	if (!combined.trim()) {
		return [];
	}
	const segments = combined
		.split(/^(?=diff --git )/m)
		.filter((segment) => segment.startsWith('diff --git'));
	return segments.map((patch) => {
		const file = parseSingleFileDiff(patch);
		const path = file
			? file.newPath && file.newPath !== '/dev/null'
				? file.newPath
				: file.oldPath
			: '';
		return { patch, path };
	});
}

/** Old- and new-side source text reconstructed from a diff's hunks. */
interface SideSources {
	newText: string;
	oldText: string;
}

/**
 * Place a line's content at its 1-based position in a sparse line array,
 * growing the array with blanks so every index maps to its true line number.
 * @param lines - The sparse line array being filled (mutated copy semantics handled by caller)
 * @param lineNumber - The 1-based line number to write at
 * @param content - The line content to place
 */
function placeLine(lines: string[], lineNumber: number, content: string): void {
	for (let index = lines.length; index < lineNumber; index += 1) {
		lines[index] = '';
	}
	lines[lineNumber - 1] = content;
}

/**
 * Reconstruct old- and new-side source text from a diff's hunks so Shiki can
 * tokenize each side with line numbers that line up with the change line
 * numbers. Only lines present in the patch are filled; gaps between hunks stay
 * blank, which is enough for per-line syntax colors even though cross-hunk
 * multiline constructs are not bridged.
 * @param hunks - The parsed hunks of a single file diff
 * @returns The reconstructed old and new source text
 */
export function reconstructSideSources(
	hunks: readonly HunkData[],
): SideSources {
	const oldLines: string[] = [];
	const newLines: string[] = [];

	for (const hunk of hunks) {
		for (const change of hunk.changes) {
			if (isNormal(change)) {
				placeLine(oldLines, change.oldLineNumber, change.content);
				placeLine(newLines, change.newLineNumber, change.content);
			} else if (isDelete(change)) {
				placeLine(oldLines, change.lineNumber, change.content);
			} else if (isInsert(change)) {
				placeLine(newLines, change.lineNumber, change.content);
			}
		}
	}

	return { newText: newLines.join('\n'), oldText: oldLines.join('\n') };
}

/**
 * Reverse-apply a file's hunks to its current content to reconstruct the full
 * old (base) source, so the viewer can expand a diff into the whole file
 * without a separate git read. Only valid when `newContent` is the exact new
 * side of the diff (i.e. the working-tree file for a working-tree diff).
 * @param newContent - The current full file content (the diff's new side)
 * @param hunks - The file's parsed hunks, in order
 * @returns The reconstructed full old-side source text
 */
export function reconstructOldSource(
	newContent: string,
	hunks: readonly HunkData[],
): string {
	const newLines = newContent.split('\n');
	const oldLines: string[] = [];
	let cursor = 0;

	for (const hunk of hunks) {
		while (cursor < hunk.newStart - 1 && cursor < newLines.length) {
			oldLines.push(newLines[cursor] ?? '');
			cursor += 1;
		}
		for (const change of hunk.changes) {
			if (isNormal(change)) {
				oldLines.push(change.content);
				cursor += 1;
			} else if (isDelete(change)) {
				oldLines.push(change.content);
			} else {
				cursor += 1;
			}
		}
	}

	while (cursor < newLines.length) {
		oldLines.push(newLines[cursor] ?? '');
		cursor += 1;
	}

	return oldLines.join('\n');
}

/**
 * Read a change's old-side line number, or null when it has none (an insert).
 * @param change - The change to inspect
 * @returns The 1-based old line number, or null
 */
export function oldLineNumberOf(change: ChangeData): number | null {
	if (isNormal(change)) {
		return change.oldLineNumber;
	}
	if (isDelete(change)) {
		return change.lineNumber;
	}
	return null;
}

/**
 * Read a change's new-side line number, or null when it has none (a delete).
 * @param change - The change to inspect
 * @returns The 1-based new line number, or null
 */
export function newLineNumberOf(change: ChangeData): number | null {
	if (isNormal(change)) {
		return change.newLineNumber;
	}
	if (isInsert(change)) {
		return change.lineNumber;
	}
	return null;
}
