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
 * tool presenters read. Two shapes today: a file-editing tool's unified patch,
 * and the background-task fields the `Bash` / `Agent` / `TaskOutput` / `TaskStop`
 * tools carry outside the prose their `content` blocks send to the model. A
 * background field lands only when the raw `tool_use_result` actually reports
 * it, so results that are neither an edit nor a background lifecycle event
 * still yield null and the timeline reads them as it always has.
 * @param toolUseResult - The `tool_use_result` field of a `user` SDK message
 * @returns The details bag, or null when the result carries nothing to project
 */
export function toolResultDetails(
	toolUseResult: unknown,
): Record<string, unknown> | null {
	if (!isRecord(toolUseResult)) {
		return null;
	}
	const patch = describesNewFile(toolUseResult)
		? null
		: readPatch(toolUseResult);
	const background = readBackgroundTaskFields(toolUseResult);
	if (patch === null && background === null) {
		return null;
	}
	return { ...(background ?? {}), ...(patch ?? {}) };
}

/**
 * Reads the unified-diff `patch` field a file-editing tool result carries.
 * @param toolUseResult - The structured result to project
 * @returns The `{ patch }` bag, or null when the result has no complete hunks
 */
function readPatch(
	toolUseResult: Record<string, unknown>,
): Record<string, unknown> | null {
	const hunks = readHunks(toolUseResult.structuredPatch);
	if (hunks.length === 0) {
		return null;
	}
	return { patch: unifiedPatch(readPath(toolUseResult.filePath), hunks) };
}

/**
 * Reads the background-task lifecycle fields a `Bash` / `Agent` / `TaskOutput`
 * / `TaskStop` result carries. Every field is optional and each is emitted only
 * when the SDK actually reported it, so the shape a reducer or presenter reads
 * matches what the runtime said rather than a normalized union.
 *
 * - `backgroundTaskId` (Bash launch confirmation and poll while the task lives)
 * - `agentId` + `isAsync: true` (Agent `async_launched`)
 * - `taskId` (poll / stop input id, resolved through legacy `shell_id`)
 * - `exitCode`, `interrupted`, `timedOutAfterMs`, `backgroundedByUser` (Bash output)
 * - `status` (poll status word, when the SDK sends one)
 * - `outputFile` (path the async agent writes to)
 * @param toolUseResult - The structured result to inspect
 * @returns The background-task bag, or null when nothing to project
 */
function readBackgroundTaskFields(
	toolUseResult: Record<string, unknown>,
): Record<string, unknown> | null {
	const fields: Record<string, unknown> = {};
	const backgroundTaskId = readNonEmptyString(toolUseResult.backgroundTaskId);
	if (backgroundTaskId !== null) {
		fields.backgroundTaskId = backgroundTaskId;
	}
	const taskId =
		readNonEmptyString(toolUseResult.task_id) ??
		readNonEmptyString(toolUseResult.taskId) ??
		readNonEmptyString(toolUseResult.shell_id);
	if (taskId !== null) {
		fields.taskId = taskId;
	}
	const agentId = readNonEmptyString(toolUseResult.agentId);
	if (agentId !== null && toolUseResult.isAsync === true) {
		fields.agentId = agentId;
		fields.isAsync = true;
	}
	const status = readNonEmptyString(toolUseResult.status);
	if (status !== null) {
		fields.status = status;
	}
	const exitCode = readCount(toolUseResult.exitCode);
	if (exitCode !== null) {
		fields.exitCode = exitCode;
	}
	if (toolUseResult.interrupted === true) {
		fields.interrupted = true;
	}
	if (toolUseResult.backgroundedByUser === true) {
		fields.backgroundedByUser = true;
	}
	const timedOutAfterMs = readCount(toolUseResult.timedOutAfterMs);
	if (timedOutAfterMs !== null) {
		fields.timedOutAfterMs = timedOutAfterMs;
	}
	const outputFile = readNonEmptyString(toolUseResult.outputFile);
	if (outputFile !== null) {
		fields.outputFile = outputFile;
	}
	return Object.keys(fields).length === 0 ? null : fields;
}

/**
 * Reads an unknown value as a non-empty string, rejecting anything else.
 * @param value - Raw field value
 * @returns The trimmed non-empty string, or null when the field carries none
 */
function readNonEmptyString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
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
