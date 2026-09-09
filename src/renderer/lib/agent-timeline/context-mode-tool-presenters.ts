import type { DynamicToolUIPart } from 'ai';
import type { BundledLanguage } from 'shiki';
import { i18n } from '@/renderer/lib/i18n';
import type {
	ToolBodyDescriptor,
	ToolGlyph,
	ToolPresenterResult,
	ToolPreviewDescriptor,
} from '@/renderer/types/tool-presentation';
import { inputOf, outputOf, pathOf, stringField } from './tool-part-fields';
import { fileBadge, textBody } from './tool-presenter-helpers';

/** Icon assignments for context-mode tools with dedicated presentation. */
export const CONTEXT_MODE_TOOL_GLYPHS = {
	ctx_batch_execute: 'square-terminal',
	ctx_doctor: 'stethoscope',
	ctx_execute: 'square-terminal',
	ctx_execute_file: 'square-terminal',
	ctx_fetch_and_index: 'network',
	ctx_index: 'brain',
	ctx_insight: 'panels-top-left',
	ctx_purge: 'square-x',
	ctx_search: 'search',
	ctx_stats: 'brain',
	ctx_upgrade: 'puzzle',
} satisfies Record<string, ToolGlyph>;

/**
 * Removes context-mode's exact fenced echo of the submitted program.
 * @param text - Full execution result text
 * @param echo - Source and protocol metadata used to build the expected echo
 * @returns The subprocess output without the duplicated program
 */
function stripContextExecutionEcho(
	text: string,
	echo: { code: string; language: string | null; path: string | null },
): string {
	if (echo.language === null) {
		return text;
	}
	const pathPrefix = echo.path === null ? '' : `path=${echo.path}\n`;
	const sourceEcho = `${pathPrefix}\`\`\`${echo.language}\n${echo.code}\n\`\`\`\n\n`;
	return text.startsWith(sourceEcho) ? text.slice(sourceEcho.length) : text;
}

/**
 * Names the context-mode execution variant in the active locale.
 * @param toolName - Runtime name of the execution tool
 * @returns The title for a sandbox execution or file-processing call
 */
function contextExecutionTitle(toolName: string): string {
	if (toolName.toLowerCase() === 'ctx_execute_file') {
		return i18n.t('workbench:tool-call.ctx-execute-file.title', 'Process file');
	}
	return i18n.t('workbench:tool-call.ctx-execute.title', 'Run code');
}

/**
 * Presents context-mode execution as separate source and output blocks.
 * @param part - A `ctx_execute` or `ctx_execute_file` tool part to project
 * @returns The row's title, target, intent preview, source, and subprocess output
 */
function presentContextExecution(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const code = stringField(input, 'code') ?? '';
	const intent = stringField(input, 'intent');
	const compactCode = code.replace(/\s+/g, ' ').trim();
	const previewText = intent ?? compactCode;
	const isFileExecution = part.toolName.toLowerCase() === 'ctx_execute_file';
	return {
		badge: isFileExecution ? fileBadge(pathOf(input)) : null,
		body: {
			kind: 'labeled',
			sections: [
				{
					label: i18n.t('workbench:tool-call.ctx-execute.code-label', 'Code:'),
					muted: true,
					text: code,
				},
				{
					label: i18n.t('workbench:tool-call.generic.output-label', 'Output:'),
					muted: false,
					text: stripContextExecutionEcho(outputOf(part)?.text ?? '', {
						code,
						language: stringField(input, 'language'),
						path: isFileExecution ? pathOf(input) : null,
					}),
				},
			],
		},
		preview:
			previewText.length === 0
				? null
				: { font: intent === null ? 'mono' : 'sans', text: previewText },
		title: contextExecutionTitle(part.toolName),
		tone: 'default',
	};
}

/**
 * Reads a string array from a context-mode tool input.
 * @param input - Tool input record to inspect
 * @param key - Array field to read
 * @returns Trimmed, non-empty strings in their original order
 */
function stringArrayField(
	input: Record<string, unknown>,
	key: string,
): string[] {
	const value = input[key];
	if (!Array.isArray(value)) {
		return [];
	}
	return value.flatMap((item) =>
		typeof item === 'string' && item.trim().length > 0 ? [item.trim()] : [],
	);
}

/**
 * Reads named values from object entries in a context-mode tool input.
 * @param input - Tool input record to inspect
 * @param key - Array field containing object entries
 * @param fields - Entry fields to try in priority order
 * @returns The first named value from each entry
 */
function nestedStringFields(
	input: Record<string, unknown>,
	key: string,
	fields: readonly string[],
): string[] {
	const value = input[key];
	if (!Array.isArray(value)) {
		return [];
	}
	return value.flatMap((item) => {
		if (typeof item !== 'object' || item === null || Array.isArray(item)) {
			return [];
		}
		const named = stringField(item as Record<string, unknown>, ...fields);
		return named === null ? [] : [named];
	});
}

/**
 * Removes credentials, query parameters, and fragments from a URL preview.
 * @param value - URL supplied to a context-mode fetch
 * @returns A safe origin-and-path preview, or null when the URL is invalid
 */
function sanitizedUrlPreview(value: string | null): string | null {
	if (value === null) {
		return null;
	}
	try {
		const url = new URL(value);
		url.username = '';
		url.password = '';
		url.search = '';
		url.hash = '';
		return url.toString();
	} catch {
		return null;
	}
}

/**
 * Names direct or batched fetch targets without exposing URL secrets.
 * @param input - Fetch-and-index input to summarize
 * @returns Source labels or sanitized URLs in request order
 */
function contextFetchTargets(input: Record<string, unknown>): string[] {
	const directSource = stringField(input, 'source');
	if (directSource !== null) {
		return [directSource];
	}
	const directUrl = sanitizedUrlPreview(stringField(input, 'url'));
	if (directUrl !== null) {
		return [directUrl];
	}
	const requests = input.requests;
	if (!Array.isArray(requests)) {
		return [];
	}
	return requests.flatMap((request) => {
		if (
			typeof request !== 'object' ||
			request === null ||
			Array.isArray(request)
		) {
			return [];
		}
		const entry = request as Record<string, unknown>;
		const target =
			stringField(entry, 'source') ??
			sanitizedUrlPreview(stringField(entry, 'url'));
		return target === null ? [] : [target];
	});
}

/**
 * Builds a collapsed preview from the meaningful values in one tool input.
 * @param values - Values to join into one summary
 * @param font - Typography appropriate to prose or machine-readable values
 * @returns A compact preview, or null when no values are present
 */
function contextPreview(
	values: readonly string[],
	font: 'mono' | 'sans' = 'sans',
): ToolPreviewDescriptor | null {
	const visibleValues = values.filter((value) => value.length > 0);
	return visibleValues.length === 0
		? null
		: { font, text: visibleValues.join(' · ') };
}

/**
 * Presents a context-mode result without repeating its usually large input.
 * @param part - Context-mode tool part whose output should be shown
 * @param title - Localized activity title
 * @param preview - Collapsed summary of the input target
 * @returns A compact row with the tool result as its expandable body
 */
function presentContextOutput(
	part: DynamicToolUIPart,
	title: string,
	preview: ToolPreviewDescriptor | null,
): ToolPresenterResult {
	const text = outputOf(part)?.text ?? '';
	const body: ToolBodyDescriptor =
		text.length === 0
			? { kind: 'empty' }
			: textBody(text, 'text' as BundledLanguage);
	return {
		badge: null,
		body,
		preview,
		title,
		tone: 'default',
	};
}

/**
 * Presents a batched command run with labels in the preview and commands in the body.
 * @param part - The `ctx_batch_execute` tool part to project
 * @returns The row's title, command-label preview, commands, and indexed result
 */
function presentContextBatch(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	return {
		badge: null,
		body: {
			kind: 'labeled',
			sections: [
				{
					label: i18n.t(
						'workbench:tool-call.ctx-batch-execute.commands-label',
						'Commands:',
					),
					muted: true,
					text: nestedStringFields(input, 'commands', ['command']).join('\n'),
				},
				{
					label: i18n.t('workbench:tool-call.generic.output-label', 'Output:'),
					muted: false,
					text: outputOf(part)?.text ?? '',
				},
			],
		},
		preview: contextPreview(nestedStringFields(input, 'commands', ['label'])),
		title: i18n.t(
			'workbench:tool-call.ctx-batch-execute.title',
			'Run commands',
		),
		tone: 'default',
	};
}

/**
 * Presents documentation fetching by source name or sanitized URL.
 * @param part - The `ctx_fetch_and_index` tool part to project
 * @returns The row's title, fetched-source preview, and indexing result
 */
function presentContextFetch(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	return presentContextOutput(
		part,
		i18n.t('workbench:tool-call.ctx-fetch-and-index.title', 'Fetch and index'),
		contextPreview(contextFetchTargets(input)),
	);
}

/**
 * Presents local indexing with its path pinned to the activity row.
 * @param part - The `ctx_index` tool part to project
 * @returns The row's title, source preview, path badge, and indexing result
 */
function presentContextIndex(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const path = pathOf(input);
	const source = stringField(input, 'source');
	return {
		...presentContextOutput(
			part,
			i18n.t('workbench:tool-call.ctx-index.title', 'Index context'),
			contextPreview(source === null ? [] : [source]),
		),
		badge: fileBadge(path),
	};
}

/**
 * Presents a knowledge-base search by its submitted queries.
 * @param part - The `ctx_search` tool part to project
 * @returns The row's title, query preview, and focused search results
 */
function presentContextSearch(part: DynamicToolUIPart): ToolPresenterResult {
	return presentContextOutput(
		part,
		i18n.t('workbench:tool-call.ctx-search.title', 'Search context'),
		contextPreview(stringArrayField(inputOf(part), 'queries')),
	);
}

/**
 * Presents a context-mode installation check.
 * @param part - The `ctx_doctor` tool part to project
 * @returns The row's localized title and diagnostic result
 */
function presentContextDoctor(part: DynamicToolUIPart): ToolPresenterResult {
	return presentContextOutput(
		part,
		i18n.t('workbench:tool-call.ctx-doctor.title', 'Check context mode'),
		null,
	);
}

/**
 * Presents opening the context-mode Insight dashboard.
 * @param part - The `ctx_insight` tool part to project
 * @returns The row's localized title and launch result
 */
function presentContextInsight(part: DynamicToolUIPart): ToolPresenterResult {
	return presentContextOutput(
		part,
		i18n.t('workbench:tool-call.ctx-insight.title', 'Open Insight'),
		null,
	);
}

/**
 * Presents destructive context removal with its requested scope.
 * @param part - The `ctx_purge` tool part to project
 * @returns The row's localized title, scope preview, and purge result
 */
function presentContextPurge(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const scope = stringField(input, 'scope');
	const sessionId = stringField(input, 'sessionId');
	const previewValues = [scope, sessionId].flatMap((value) =>
		value === null ? [] : [value],
	);
	return presentContextOutput(
		part,
		i18n.t('workbench:tool-call.ctx-purge.title', 'Purge context'),
		contextPreview(previewValues, 'mono'),
	);
}

/**
 * Presents context-mode usage statistics.
 * @param part - The `ctx_stats` tool part to project
 * @returns The row's localized title and usage result
 */
function presentContextStats(part: DynamicToolUIPart): ToolPresenterResult {
	return presentContextOutput(
		part,
		i18n.t('workbench:tool-call.ctx-stats.title', 'Context usage'),
		null,
	);
}

/**
 * Presents a context-mode upgrade command.
 * @param part - The `ctx_upgrade` tool part to project
 * @returns The row's localized title and upgrade result
 */
function presentContextUpgrade(part: DynamicToolUIPart): ToolPresenterResult {
	return presentContextOutput(
		part,
		i18n.t('workbench:tool-call.ctx-upgrade.title', 'Upgrade context mode'),
		null,
	);
}

/** Dedicated presenters for the complete context-mode tool surface. */
export const CONTEXT_MODE_TOOL_PRESENTERS = {
	ctx_batch_execute: presentContextBatch,
	ctx_doctor: presentContextDoctor,
	ctx_execute: presentContextExecution,
	ctx_execute_file: presentContextExecution,
	ctx_fetch_and_index: presentContextFetch,
	ctx_index: presentContextIndex,
	ctx_insight: presentContextInsight,
	ctx_purge: presentContextPurge,
	ctx_search: presentContextSearch,
	ctx_stats: presentContextStats,
	ctx_upgrade: presentContextUpgrade,
} satisfies Record<string, (part: DynamicToolUIPart) => ToolPresenterResult>;
