import type { DynamicToolUIPart } from 'ai';
import { i18n } from '@/renderer/lib/i18n';
import type {
	ToolBodyDescriptor,
	ToolPresenterResult,
	ToolPreviewDescriptor,
} from '@/renderer/types/tool-presentation';
import type { GetWorkspaceDiffResult } from '@/shared/agent-control/contracts';
import {
	codeSpan,
	controlPayloadRecord,
	isRecord,
	numberValue,
} from './ensemblr-control-presenter-helpers';
import { inputOf, outputOf, pathOf } from './tool-part-fields';
import { fileBadge, languageFor, patchCounts } from './tool-presenter-helpers';

/** Opens the `diff` string of a JSON envelope, wherever a cut-off leaves it. */
const DIFF_FIELD_OPENING = /"diff"\s*:\s*"/;

/** Characters in a JSON `\uXXXX` escape. */
const UNICODE_ESCAPE_LENGTH = 6;

/** One changed workspace file as returned by the diff tool's stat response. */
interface WorkspaceDiffFile {
	additions: number | null;
	deletions: number | null;
	path: string;
	status: string | null;
}

/** Totals returned with a whole-diff or stat response. */
interface WorkspaceDiffSummary {
	additions: number | null;
	deletions: number | null;
	files: number | null;
}

/** The successful payload returned by `ensemblr_get_workspace_diff`. */
interface WorkspaceDiffData {
	baseRef: GetWorkspaceDiffResult['baseRef'];
	diff: Exclude<GetWorkspaceDiffResult['diff'], undefined> | null;
	files: readonly WorkspaceDiffFile[] | null;
	omittedFiles: GetWorkspaceDiffResult['omittedFiles'];
	summary: WorkspaceDiffSummary | null;
	truncated: GetWorkspaceDiffResult['truncated'];
}

/**
 * Reads one changed-file row from a structured tool response.
 * @param value - Untrusted changed-file value
 * @returns The file row, or null when it has no usable path
 */
function readFile(value: unknown): WorkspaceDiffFile | null {
	if (
		!isRecord(value) ||
		typeof value.path !== 'string' ||
		value.path.length === 0
	) {
		return null;
	}
	return {
		additions: numberValue(value, 'additions'),
		deletions: numberValue(value, 'deletions'),
		path: value.path,
		status: typeof value.status === 'string' ? value.status : null,
	};
}

/**
 * Reads the aggregate diff counts from a structured tool response.
 * @param value - Untrusted summary value
 * @returns The summary, or null when it is malformed
 */
function readSummary(value: unknown): WorkspaceDiffSummary | null {
	if (!isRecord(value)) {
		return null;
	}
	return {
		additions: numberValue(value, 'additions'),
		deletions: numberValue(value, 'deletions'),
		files: numberValue(value, 'files'),
	};
}

/**
 * Normalizes a workspace-diff response before it is rendered.
 * @param part - Completed workspace-diff tool call
 * @returns Diff data, or null when the call supplied no usable payload
 */
function workspaceDiffData(part: DynamicToolUIPart): WorkspaceDiffData | null {
	const payload = controlPayloadRecord(part);
	if (payload === null) {
		return null;
	}
	const files = Array.isArray(payload.files)
		? payload.files.flatMap((file) => {
				const parsed = readFile(file);
				return parsed === null ? [] : [parsed];
			})
		: null;
	return {
		baseRef: typeof payload.baseRef === 'string' ? payload.baseRef : null,
		diff: typeof payload.diff === 'string' ? payload.diff : null,
		files,
		omittedFiles: Array.isArray(payload.omittedFiles)
			? payload.omittedFiles.filter(
					(path): path is string => typeof path === 'string',
				)
			: [],
		summary: readSummary(payload.summary),
		truncated: payload.truncated === true,
	};
}

/**
 * Produces the compact summary shown while a diff response is collapsed.
 * @param summary - Aggregate diff totals, when available
 * @param file - Requested file metadata, when available
 * @param baseRef - Diff base reference, when available
 * @returns A readable one-line diff summary
 */
function previewText(
	summary: WorkspaceDiffSummary | null,
	file: WorkspaceDiffFile | null,
	baseRef: string | null,
): string | null {
	const counts = summary ?? file;
	if (counts === null) {
		return baseRef;
	}
	const parts: string[] = [];
	if (summary?.files !== null && summary?.files !== undefined) {
		parts.push(
			i18n.t('workbench:turn-diff.file-count', {
				count: summary.files,
				defaultValue_one: '{{count}} file',
				defaultValue_other: '{{count}} files',
			}),
		);
	}
	const changeCounts = [
		counts.additions === null ? null : `+${counts.additions}`,
		counts.deletions === null ? null : `−${counts.deletions}`,
	].filter((count): count is string => count !== null);
	if (changeCounts.length > 0) {
		parts.push(changeCounts.join(' '));
	}
	if (baseRef !== null) {
		parts.push(baseRef);
	}
	return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Localizes a git file status already used by the review surface.
 * @param status - Status code returned by the diff tool
 * @returns Localized label, or null when absent
 */
function statusLabel(status: string | null): string | null {
	switch (status) {
		case 'added':
			return i18n.t('review:file-status.added', 'Added');
		case 'conflicted':
			return i18n.t('review:file-status.conflicted', 'Conflicted');
		case 'deleted':
			return i18n.t('review:file-status.deleted', 'Deleted');
		case 'modified':
			return i18n.t('review:file-status.modified', 'Modified');
		case 'renamed':
			return i18n.t('review:file-status.renamed', 'Renamed');
		case 'untracked':
			return i18n.t('review:file-status.untracked', 'Untracked');
		default:
			return status;
	}
}

/**
 * Renders the stat response as one readable Markdown item per changed file.
 * @param files - Changed files from a stat response
 * @returns The Markdown list body
 */
function statMarkdown(files: readonly WorkspaceDiffFile[]): string {
	return files
		.map((file) => {
			const counts = [
				file.additions === null ? null : `**+${file.additions}**`,
				file.deletions === null ? null : `−${file.deletions}`,
			].filter((count): count is string => count !== null);
			const status = statusLabel(file.status);
			return `- ${codeSpan(file.path)}${status ? ` · ${status}` : ''}${counts.length > 0 ? ` · ${counts.join(' ')}` : ''}`;
		})
		.join('\n');
}

/**
 * Resolves counts for a requested file without treating a whole-workspace read
 * as a single-file operation.
 * @param data - Normalized workspace-diff result
 * @param path - Requested file path
 * @returns File metadata with parsed line counts, or null for workspace reads
 */
function badgeFile(
	data: WorkspaceDiffData,
	path: string | null,
): WorkspaceDiffFile | null {
	if (path === null || data.diff === null) {
		return null;
	}
	return { ...patchCounts(data.diff), path, status: null };
}

/**
 * Ensures top-level truncation metadata remains visible when git supplied no
 * prose pointer of its own.
 * @param data - Normalized workspace-diff result carrying patch metadata
 * @returns The original patch, or the patch with one translated notice
 */
function visiblePatch(data: WorkspaceDiffData): string {
	const patch = data.diff ?? '';
	const hasPointer = patch.startsWith('… ') || patch.includes('\n\n… ');
	if ((!data.truncated && data.omittedFiles.length === 0) || hasPointer) {
		return patch;
	}
	const notice = `… ${i18n.t('review:file-diff.truncated', 'Diff truncated')}`;
	const body = patch.trimEnd();
	return body ? `${body}\n\n${notice}` : notice;
}

/**
 * Selects the expanded representation for a workspace-diff response.
 * @param data - Normalized workspace-diff result
 * @param path - Requested file path
 * @returns Markdown stat rows, a real patch, or an empty body
 */
function diffBody(
	data: WorkspaceDiffData,
	path: string | null,
): ToolBodyDescriptor {
	if (data.diff !== null) {
		return {
			kind: 'diff',
			language: languageFor(path),
			patch: visiblePatch(data),
			showFileNames: path === null,
		};
	}
	return data.files === null
		? { kind: 'empty' }
		: { kind: 'markdown', text: statMarkdown(data.files) };
}

/**
 * Builds the optional collapsed line for a workspace-diff response.
 * @param data - Normalized workspace-diff result
 * @param file - Badge file metadata, when available
 * @returns The one-line preview, or null when the payload gave no summary
 */
function diffPreview(
	data: WorkspaceDiffData,
	file: WorkspaceDiffFile | null,
): ToolPreviewDescriptor | null {
	const text = previewText(data.summary, file, data.baseRef);
	return text === null ? null : { font: 'sans', text };
}

/**
 * Reads the string a truncated JSON document was in the middle of, stopping at
 * its closing quote or before an escape the cut left incomplete.
 * @param text - JSON text that may end anywhere
 * @param start - Index of the first character after the string's opening quote
 * @returns The still-encoded characters the text carries for that string
 */
function encodedStringPrefix(text: string, start: number): string {
	let end = start;
	while (end < text.length && text[end] !== '"') {
		if (text[end] !== '\\') {
			end += 1;
			continue;
		}
		const escapeLength = text[end + 1] === 'u' ? UNICODE_ESCAPE_LENGTH : 2;
		if (end + escapeLength > text.length) {
			break;
		}
		end += escapeLength;
	}
	return text.slice(start, end);
}

/**
 * Finds a unified patch in the raw text of a response that did not parse as
 * JSON: the text itself when it is a bare patch, or the `diff` string of a JSON
 * envelope cut short by the transport, decoded as far as it reaches.
 * @param text - The raw output text
 * @returns The patch text, or null when the text carries no `diff --git` header
 */
function recoverPatch(text: string): string | null {
	const field = text.trimStart().startsWith('{')
		? DIFF_FIELD_OPENING.exec(text)
		: null;
	let patch: string | null = text;
	if (field !== null) {
		try {
			patch = JSON.parse(
				`"${encodedStringPrefix(text, field.index + field[0].length)}"`,
			);
		} catch {
			patch = null;
		}
	}
	return patch?.includes('diff --git') ? patch : null;
}

/**
 * Chooses what the card shows when the diff payload could not be read, so a
 * truncated or malformed response still surfaces whatever it carried.
 * @param part - The completed workspace-diff tool call
 * @param path - Requested file path
 * @returns A diff of the recoverable patch, the raw text as code, or an empty body
 */
function unreadableBody(
	part: DynamicToolUIPart,
	path: string | null,
): ToolBodyDescriptor {
	const text = outputOf(part)?.text ?? '';
	const patch = recoverPatch(text);
	if (patch !== null) {
		return {
			kind: 'diff',
			language: languageFor(path),
			patch,
			showFileNames: path === null,
		};
	}
	return text.trim() === ''
		? { kind: 'empty' }
		: {
				code: text,
				kind: 'code',
				language: languageFor(null),
				startLine: null,
			};
}

/**
 * Presents a workspace diff response as a patch or a Markdown stat list.
 * @param part - The `ensemblr_get_workspace_diff` tool part to project
 * @returns The row body, counts, and collapsed summary
 */
export function presentWorkspaceDiff(
	part: DynamicToolUIPart,
): ToolPresenterResult {
	const path = pathOf(inputOf(part));
	const data = workspaceDiffData(part);
	if (data === null) {
		return {
			badge: fileBadge(path),
			body: unreadableBody(part, path),
			preview: null,
			title: i18n.t(
				'workbench:control-tool.get-workspace-diff.done',
				'Read the diff',
			),
			tone: 'default',
		};
	}
	const file = badgeFile(data, path);
	return {
		badge: fileBadge(path, 'file', file),
		body: diffBody(data, path),
		preview: diffPreview(data, file),
		title: i18n.t(
			'workbench:control-tool.get-workspace-diff.done',
			'Read the diff',
		),
		tone: 'default',
	};
}
