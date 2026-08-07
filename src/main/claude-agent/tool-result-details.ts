/** One hunk of the structured patch Claude's file-editing tools report. */
interface StructuredPatchHunk {
	lines: readonly string[];
	newLines: number;
	newStart: number;
	oldLines: number;
	oldStart: number;
}

/**
 * Projects Claude's structured tool output onto the `details` bag the timeline's
 * tool presenters read. Only changes to a file carry anything today: the unified
 * patch their card renders as a diff, instead of the prose confirmation the tool
 * writes back to the model.
 * @param toolUseResult - The `tool_use_result` field of a `user` SDK message
 * @returns The details bag, or null when the result carries nothing to project
 */
export function toolResultDetails(
	toolUseResult: unknown,
): Record<string, unknown> | null {
	if (!isRecord(toolUseResult) || describesNewFile(toolUseResult)) {
		return null;
	}
	const hunks = readHunks(toolUseResult.structuredPatch);
	if (hunks.length === 0) {
		return null;
	}
	return { patch: unifiedPatch(readPath(toolUseResult.filePath), hunks) };
}

/**
 * Whether the result reports a file the tool created rather than changed. Such a
 * patch is the whole file marked up as additions, which its card already shows
 * as content — carrying it would persist a second copy nothing renders.
 * @param toolUseResult - The structured result to classify
 * @returns True when the result describes a creation
 */
function describesNewFile(toolUseResult: Record<string, unknown>): boolean {
	return toolUseResult.type === 'create';
}

/**
 * Reads a structured patch as the hunks it holds, dropping entries that do not
 * carry a complete range — a half-described hunk would render as a diff whose
 * line numbers disagree with the file.
 * @param value - The raw `structuredPatch` field
 * @returns The usable hunks, empty when the field describes none
 */
function readHunks(value: unknown): readonly StructuredPatchHunk[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.flatMap((entry) => {
		if (!isRecord(entry) || !Array.isArray(entry.lines)) {
			return [];
		}
		const oldStart = readCount(entry.oldStart);
		const oldLines = readCount(entry.oldLines);
		const newStart = readCount(entry.newStart);
		const newLines = readCount(entry.newLines);
		if (
			oldStart === null ||
			oldLines === null ||
			newStart === null ||
			newLines === null
		) {
			return [];
		}
		return [
			{
				lines: entry.lines.filter(
					(line): line is string => typeof line === 'string',
				),
				newLines,
				newStart,
				oldLines,
				oldStart,
			},
		];
	});
}

/**
 * Renders structured hunks as the single-file unified patch the diff surface
 * parses.
 * @param path - Path the edited file reports
 * @param hunks - The hunks to render
 * @returns The unified patch text
 */
function unifiedPatch(
	path: string,
	hunks: readonly StructuredPatchHunk[],
): string {
	const header = `--- ${path}\n+++ ${path}\n`;
	return header + hunks.map(renderHunk).join('');
}

/**
 * Renders one hunk as its range header followed by its marked lines.
 * @param hunk - The hunk to render
 * @returns The hunk's unified-diff text, newline-terminated
 */
function renderHunk(hunk: StructuredPatchHunk): string {
	const range = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`;
	return range + hunk.lines.map((line) => `${line}\n`).join('');
}

/**
 * Reads the edited path, falling back to a placeholder so a patch missing its
 * file name still parses as one file's diff.
 * @param value - The raw `filePath` field
 * @returns The path to name in the patch header
 */
function readPath(value: unknown): string {
	return typeof value === 'string' && value.length > 0 ? value : 'file';
}

/**
 * Reads a field as a non-negative line counter.
 * @param value - Raw field value
 * @returns The count, or null when the field carries no usable number
 */
function readCount(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0
		? value
		: null;
}

/**
 * Narrows an unknown value to a plain object.
 * @param value - Candidate value
 * @returns True when `value` is a non-array object
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
