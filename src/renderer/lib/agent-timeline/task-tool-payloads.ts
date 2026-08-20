import type {
	ToolChecklistItem,
	ToolChecklistStatus,
} from '@/renderer/types/tool-presentation';

/**
 * Reading the plain-text payloads Claude Code's task tools answer with.
 *
 * The harness reports its task list as prose rather than as structured data —
 * `Task #1 created successfully: …`, `#1 [pending] …`, a `Task #2:` block with
 * `Status:` and `Description:` lines — so a legible row has to parse it. Every
 * reader here degrades to null or to an empty list rather than throwing, because
 * the wording belongs to the harness and may change under the app.
 */

/** Matches the number a create call reports back, e.g. `Task #7 created`. */
const CREATED_NUMBER = /^Task\s+#(\d+)\b/;

/** Matches one summary line of a task list, e.g. `#1 [pending] Ship it`. */
const LIST_ENTRY = /^#(\d+)\s+\[([^\]]*)\]\s*(.*)$/;

/** Matches the opening line of a task detail block, e.g. `Task #2: Ship it`. */
const DETAIL_HEADING = /^Task\s+#(\d+):\s*(.*)$/;

/** Matches a `Label: value` line inside a task detail block. */
const DETAIL_FIELD = /^([A-Za-z ]+):\s*(.*)$/;

/** Matches the `[blocked by #1, #3]` note a list line ends with. */
const LIST_BLOCKED_BY = /\s*\[blocked by[^\]]*\]$/i;

/** Matches the `(owner)` note a list line ends with. */
const LIST_OWNER = /\s*\(([^\s()]+)\)$/;

/**
 * The labels a detail block reports after its description, which close it.
 *
 * The harness wraps a long description across lines rather than escaping it, so
 * the only thing that ends one is the next field — and a block whose task has
 * dependencies reports `Blocks:` or `Blocked by:` right after it.
 */
const DETAIL_FIELDS_AFTER_DESCRIPTION = new Set([
	'blocked by',
	'blocks',
	'owner',
	'status',
	'subject',
]);

/** One task read out of a `TaskGet` detail block. */
export interface ParsedTaskDetail {
	description: string | null;
	number: string;
	status: ToolChecklistStatus;
	subject: string;
}

/**
 * Maps a status word the harness wrote onto the checklist's own vocabulary,
 * tolerating the snake, kebab, and spaced spellings the same state travels under.
 * @param raw - The status as the payload spelled it
 * @returns The matching checklist status, or `unknown` when nothing matches
 */
export function normalizeTaskStatus(raw: string): ToolChecklistStatus {
	const word = raw
		.trim()
		.toLowerCase()
		.replace(/[_\s]+/g, '-');
	if (word === 'pending' || word === 'todo' || word === 'queued') {
		return 'pending';
	}
	if (word === 'in-progress' || word === 'active' || word === 'running') {
		return 'in-progress';
	}
	if (word === 'completed' || word === 'complete' || word === 'done') {
		return 'completed';
	}
	return 'unknown';
}

/**
 * Reads the number a create call assigned, which the harness reports only in the
 * result text — the arguments never carry one.
 * @param text - The create call's result text
 * @returns The assigned number without its `#`, or null when none was reported
 */
export function createdTaskNumber(text: string): string | null {
	return CREATED_NUMBER.exec(text.trim())?.[1] ?? null;
}

/**
 * Splits the notes a list line carries after its subject off it.
 *
 * A listed task reports its owner and its blockers inline — `Ship it (reviewer)
 * [blocked by #1]` — and both are the harness talking rather than the subject the
 * agent wrote. The blocker note is matched on its own wording, so nothing else
 * can be mistaken for one; an owner is taken only when it is a single unspaced
 * token, the shape an agent name has. A subject genuinely ending in a one-word
 * parenthetical therefore reads it as an owner, which relocates that word to the
 * line below rather than losing it.
 * @param entry - The line's text after its number and status
 * @returns The subject alone, and the owner when the line named one
 */
function splitListEntry(entry: string): {
	owner: string | null;
	subject: string;
} {
	const unblocked = entry.replace(LIST_BLOCKED_BY, '');
	const owner = LIST_OWNER.exec(unblocked)?.[1] ?? null;
	return {
		owner,
		subject:
			owner === null
				? unblocked.trim()
				: unblocked.replace(LIST_OWNER, '').trim(),
	};
}

/**
 * Splits a task list into its items, dropping the lines that are not entries so
 * a leading header or a trailing note cannot become a task with no number.
 * @param text - The list call's result text
 * @returns One checklist item per recognized line, in the order listed
 */
export function parseTaskListItems(text: string): readonly ToolChecklistItem[] {
	return text.split('\n').flatMap((line) => {
		const matched = LIST_ENTRY.exec(line.trim());
		if (matched === null) {
			return [];
		}
		const [, number, status, entry] = matched;
		const { owner, subject } = splitListEntry(entry?.trim() ?? '');
		return [
			{
				detail: owner,
				id: `task:${number}`,
				number: number ?? null,
				status: normalizeTaskStatus(status ?? ''),
				subject,
			},
		];
	});
}

/**
 * Reads the `Status:` line of a detail block, stopping at the description so a
 * description that happens to mention a status cannot overwrite the real one.
 * @param lines - The block's lines after the heading
 * @returns The reported status, or `unknown` when the block names none
 */
function detailStatus(lines: readonly string[]): ToolChecklistStatus {
	for (const line of lines) {
		const label = detailFieldLabel(line);
		if (label === 'description') {
			return 'unknown';
		}
		if (label === 'status') {
			return normalizeTaskStatus(detailFieldValue(line));
		}
	}
	return 'unknown';
}

/**
 * Reads the field label a detail-block line opens, folded to lower case so the
 * callers above can compare it as a word.
 * @param line - The block line to read
 * @returns The label, or null when the line opens no field
 */
function detailFieldLabel(line: string): string | null {
	return DETAIL_FIELD.exec(line.trim())?.[1]?.trim().toLowerCase() ?? null;
}

/**
 * Reads what a detail-block line carries after its label.
 * @param line - The block line to read
 * @returns The value, or an empty string when the line opens no field
 */
function detailFieldValue(line: string): string {
	return DETAIL_FIELD.exec(line.trim())?.[2] ?? '';
}

/**
 * Reads a detail block's description, which runs from its own label to the next
 * field the block reports — the harness wraps a long one across lines rather
 * than escaping it, so a line break alone does not end it, but a task with
 * dependencies reports `Blocks:` straight after it and that is not description.
 * @param lines - The block's lines after the heading
 * @returns The description, or null when the block carries none
 */
function detailDescription(lines: readonly string[]): string | null {
	const start = lines.findIndex(
		(line) => detailFieldLabel(line) === 'description',
	);
	if (start === -1) {
		return null;
	}
	const wrapped = lines.slice(start + 1);
	const closedAt = wrapped.findIndex((line) => {
		const label = detailFieldLabel(line);
		return label !== null && DETAIL_FIELDS_AFTER_DESCRIPTION.has(label);
	});
	const described = [
		detailFieldValue(lines[start] ?? ''),
		...(closedAt === -1 ? wrapped : wrapped.slice(0, closedAt)),
	]
		.join('\n')
		.trim();
	return described.length > 0 ? described : null;
}

/**
 * Reads one task out of the block a `TaskGet` answers with.
 * @param text - The get call's result text
 * @returns The parsed task, or null when the text is not a detail block
 */
export function parseTaskDetail(text: string): ParsedTaskDetail | null {
	const lines = text.trim().split('\n');
	const heading = DETAIL_HEADING.exec(lines[0]?.trim() ?? '');
	if (heading === null) {
		return null;
	}
	const body = lines.slice(1);
	return {
		description: detailDescription(body),
		number: heading[1] ?? '',
		status: detailStatus(body),
		subject: heading[2]?.trim() ?? '',
	};
}
