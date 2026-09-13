import type { DynamicToolUIPart } from 'ai';
import { i18n } from '@/renderer/lib/i18n';
import type {
	ToolBodyDescriptor,
	ToolPreviewDescriptor,
} from '@/renderer/types/tool-presentation';
import { outputOf } from './tool-part-fields';

/**
 * Reading and shaping the payloads Ensemblr's own control ops hand back.
 *
 * Every `ensemblr_*` presenter starts from the same two problems. The payload
 * arrives under one of two transports — the Pi extension carries the whole
 * envelope on `details`, while the MCP bridge sends only the text it rendered,
 * which for a control op is that payload as JSON — and once read it is still an
 * untrusted shape that has changed across app versions. The readers here answer
 * null rather than throwing, so a presenter can be written as if one transport
 * and one shape had always been in use.
 *
 * The builders turn those payloads into the markdown a row unfolds. Payload
 * text is data rather than copy — an issue title, a command, a path — so it is
 * never translated; only the labels around it are.
 */

/** Longest a payload string runs inside a list row before it crowds the body. */
export const ROW_EXCERPT_LIMIT = 200;

/** Longest a child's report excerpt runs inside a wait body. */
export const REPORT_EXCERPT_LIMIT = 500;

/** Most rows a list body paints before it collapses the rest into a count. */
const MAX_LIST_ROWS = 50;

/**
 * Narrows a value to a non-array object record.
 * @param value - The value to test
 * @returns True when the value can be read as a field record
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parses a result's text as JSON, tolerating anything that is not.
 * @param text - The result text as the runtime rendered it
 * @returns The parsed value, or null when the text is not JSON
 */
function parseJson(text: string): unknown {
	const trimmed = text.trim();
	if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
		return null;
	}
	try {
		return JSON.parse(trimmed);
	} catch {
		return null;
	}
}

/**
 * Reads the payload a successful control call handed back, under either
 * transport.
 *
 * Answers the payload itself rather than a record, because a control op may
 * return a bare array — `listWorkspaces`, `listTerminals`, and `listTabs` all
 * answer `ok(array)` where their siblings wrap the rows in a field.
 * @param part - The tool part to read
 * @returns The payload, or null when the call failed, is still running, or
 * reported nothing structured
 */
function controlPayload(part: DynamicToolUIPart): unknown {
	const details = outputOf(part)?.details;
	if (isRecord(details) && typeof details.ok === 'boolean') {
		return details.ok ? (details.data ?? null) : null;
	}
	return parseJson(outputOf(part)?.text ?? '');
}

/**
 * Reads a control payload that should be a field record.
 * @param part - The tool part to read
 * @returns The payload record, or null when it is absent or not one
 */
export function controlPayloadRecord(
	part: DynamicToolUIPart,
): Record<string, unknown> | null {
	const payload = controlPayload(part);
	return isRecord(payload) ? payload : null;
}

/**
 * Reads the rows of a listing op, accepting both shapes the control surface
 * uses: a bare array, or an array under a named field.
 * @param part - The tool part to read
 * @param field - Field holding the rows when the payload wraps them
 * @returns The rows, or null when the payload carries none
 */
export function controlPayloadRows(
	part: DynamicToolUIPart,
	field: string,
): readonly unknown[] | null {
	const payload = controlPayload(part);
	if (Array.isArray(payload)) {
		return payload;
	}
	if (isRecord(payload) && Array.isArray(payload[field])) {
		return payload[field];
	}
	return null;
}

/**
 * Reads a string field, keeping only a value with something in it.
 * @param record - Field record to read
 * @param key - Field name
 * @returns The trimmed string, or null when absent or blank
 */
export function stringValue(
	record: Record<string, unknown>,
	key: string,
): string | null {
	const value = record[key];
	if (typeof value !== 'string') {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

/**
 * Reads a finite numeric field, preserving absent and malformed values as null.
 * @param record - Field record to read
 * @param key - Field name
 * @returns The number, or null
 */
export function numberValue(
	record: Record<string, unknown>,
	key: string,
): number | null {
	const value = record[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Shortens a payload string to a length a row can carry, collapsing the
 * whitespace that would otherwise break a markdown list item across lines.
 * @param text - The payload string
 * @param limit - Longest result to keep
 * @returns The collapsed, capped string
 */
export function excerpt(text: string, limit: number): string {
	const collapsed = text.replace(/\s+/g, ' ').trim();
	return collapsed.length > limit
		? `${collapsed.slice(0, limit).trimEnd()}…`
		: collapsed;
}

/**
 * Shortens a payload string and neutralizes whatever block it would otherwise
 * open, for the positions where it lands at the start of a line.
 *
 * A child's report is arbitrary markdown someone else wrote. Collapsed onto a
 * continuation line inside a list item, a leading `#` becomes a heading and a
 * leading `>` swallows the lines after it — so an excerpt meant to be read as a
 * quotation restyles the row around it. Escaping the first character is enough,
 * because the collapse already removed every other line start.
 * @param text - The payload string
 * @param limit - Longest result to keep
 * @returns The collapsed, capped string, unable to open a block
 */
export function blockSafeExcerpt(text: string, limit: number): string {
	const collapsed = excerpt(text, limit);
	return collapsed
		.replace(/^([#>\-+*`~|=])/, '\\$1')
		.replace(/^(\d+)([.)])/, '$1\\$2');
}

/**
 * Shortens a payload string while keeping its line structure, for the blocks
 * that read as prose rather than as one row.
 * @param text - The payload string
 * @param limit - Longest result to keep
 * @returns The capped string
 */
export function clamp(text: string, limit: number): string {
	const trimmed = text.trim();
	return trimmed.length > limit
		? `${trimmed.slice(0, limit).trimEnd()}…`
		: trimmed;
}

/**
 * Wraps an untrusted payload string in a Markdown code span it cannot
 * terminate. Payload text is agent- and API-supplied, so a backtick run inside
 * it would otherwise close the span and let the rest render as prose.
 * @param text - The string to render
 * @returns A single-line Markdown code span
 */
export function codeSpan(text: string): string {
	const singleLine = text.replace(/[\r\n]+/g, ' ');
	const longestRun = Math.max(
		0,
		...(singleLine.match(/`+/g) ?? []).map((run) => run.length),
	);
	if (longestRun === 0) {
		return `\`${singleLine}\``;
	}
	// i18next-instrument-ignore -- Markdown code-span delimiter
	const fence = '`'.repeat(longestRun + 1);
	return `${fence} ${singleLine} ${fence}`;
}

/**
 * Wraps an untrusted payload string in a Markdown fence it cannot terminate,
 * for the blocks that carry a whole tool input or output.
 * @param text - The string to render
 * @param language - Fence info string, empty for none
 * @returns A fenced Markdown block
 */
export function codeFence(text: string, language = ''): string {
	const longestRun = Math.max(
		0,
		...(text.match(/^`{3,}/gm) ?? []).map((run) => run.length),
	);
	// i18next-instrument-ignore -- Markdown fence delimiter
	const fence = '`'.repeat(Math.max(3, longestRun + 1));
	return `${fence}${language}\n${text}\n${fence}`;
}

/**
 * Emphasizes an untrusted payload string without letting it break the emphasis.
 * @param text - The string to render
 * @returns The string in bold, with its own asterisks escaped
 */
export function bold(text: string): string {
	return `**${text.replace(/\s+/g, ' ').trim().replace(/\*/g, '\\*')}**`;
}

/**
 * Joins the facts on one list row with the separator the timeline uses
 * everywhere, dropping the ones the payload did not report.
 * @param facts - Row facts, already rendered, any of which may be null
 * @returns The joined row, or an empty string when the payload reported none
 */
export function joinFacts(facts: readonly (string | null)[]): string {
	return facts.filter((fact): fact is string => fact !== null).join(' · ');
}

/**
 * Names how many rows a listing body left out, so a capped list never reads as
 * a complete one.
 * @param count - Rows not painted
 * @returns The trailing line, or null when nothing was left out
 */
export function omittedLine(count: number): string | null {
	return count > 0
		? i18n.t('workbench:control-tool.body.more', {
				count,
				defaultValue_one: '… and {{count}} more',
				defaultValue_other: '… and {{count}} more',
			})
		: null;
}

/**
 * Builds a markdown bullet list from already-rendered rows, capping it so one
 * listing cannot flood the row it unfolds in.
 * @param rows - Rendered rows, in payload order
 * @param limit - Most rows to paint
 * @returns The markdown list
 */
export function markdownList(
	rows: readonly string[],
	limit: number = MAX_LIST_ROWS,
): string {
	const painted = rows.slice(0, limit).map((row) => `- ${row}`);
	const omitted = omittedLine(rows.length - painted.length);
	return [...painted, ...(omitted === null ? [] : [omitted])].join('\n');
}

/**
 * Joins the blocks of a composed markdown body, dropping the sections the
 * payload gave nothing for.
 * @param blocks - Rendered blocks, any of which may be null
 * @returns The joined body
 */
export function markdownBlocks(blocks: readonly (string | null)[]): string {
	return blocks
		.filter((block): block is string => block !== null && block.length > 0)
		.join('\n\n');
}

/**
 * Renders how full a conversation's window is, which is the one fact a
 * delegating agent reads a status for.
 * @param usage - The reported usage, or null when nothing is attached
 * @returns The rendered percentage, or null when none was reported
 */
export function contextUsageText(usage: unknown): string | null {
	if (!isRecord(usage)) {
		return null;
	}
	const percent = numberValue(usage, 'percent');
	return percent === null
		? null
		: i18n.t('workbench:control-tool.preview.context', '{{percent}}% context', {
				percent: Math.round(percent),
			});
}

/**
 * What one control presenter decides. The title, glyph, and chip are resolved
 * from `ensemblr-control-tool-registry.ts` against the surface and the target's
 * role, so a presenter here contributes only what the payload can say: the body
 * the row unfolds, and the line it shows while collapsed.
 */
export interface ControlRow {
	body: ToolBodyDescriptor;
	preview: ToolPreviewDescriptor | null;
}

/**
 * The row a control op gets when it reported no payload worth unfolding — every
 * op that answers a bare `{ ok: true }`, and any whose payload could not be
 * read. Empty is the honest answer: the row's title already says what happened,
 * and the arguments stay reachable in the raw disclosure beneath it.
 * @returns The empty row
 */
export function controlAck(): ControlRow {
	return { body: { kind: 'empty' }, preview: null };
}

/**
 * Shapes a listing op's rows into the row every listing presenter shares.
 * @param rows - Rendered rows, in payload order
 * @param preview - The collapsed count line
 * @returns The listing row
 */
export function listRow(rows: readonly string[], preview: string): ControlRow {
	return {
		body:
			rows.length === 0
				? { kind: 'empty' }
				: { kind: 'markdown', text: markdownList(rows) },
		preview: { font: 'sans', text: preview },
	};
}

/**
 * Shapes a composed markdown body into a row, falling back to the empty row
 * when the payload rendered to nothing.
 * @param text - The composed markdown body
 * @param preview - The collapsed line, or null when the payload gave none
 * @returns The markdown row
 */
export function markdownRow(text: string, preview: string | null): ControlRow {
	return {
		body: text.length === 0 ? { kind: 'empty' } : { kind: 'markdown', text },
		preview:
			preview === null || preview.length === 0
				? null
				: { font: 'sans', text: preview },
	};
}
