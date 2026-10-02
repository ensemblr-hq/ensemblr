import type { DynamicToolUIPart } from 'ai';
import type { BundledLanguage } from 'shiki';
import { i18n } from '@/renderer/lib/i18n';
import type {
	ToolBodyDescriptor,
	ToolGlyph,
	ToolPresenterResult,
	ToolPreviewDescriptor,
} from '@/renderer/types/tool-presentation';
import {
	inputOf,
	numberField,
	outputOf,
	stringField,
} from './tool-part-fields';
import { textBody } from './tool-presenter-helpers';

/** Icon assignments for the complete pi-web-access tool surface. */
export const WEB_ACCESS_TOOL_GLYPHS = {
	fetch_content: 'network',
	get_search_content: 'file-text',
	source_check: 'crosshair',
	web_search: 'search',
} satisfies Record<string, ToolGlyph>;

/**
 * Builds a collapsed summary from meaningful web-tool values.
 * @param values - Optional values in display order
 * @param font - Typography for prose or machine-readable content
 * @returns A preview, or null when every value is absent
 */
function webPreview(
	values: readonly (string | null)[],
	font: 'mono' | 'sans' = 'sans',
): ToolPreviewDescriptor | null {
	const visible = values.filter((value): value is string => value !== null);
	return visible.length === 0 ? null : { font, text: visible.join(' · ') };
}

/**
 * Formats a character count for the current interface locale.
 * @param value - Character count to format
 * @returns Localized count, or null when absent
 */
function characterCount(value: number | null): string | null {
	return value === null
		? null
		: i18n.t('workbench:tool-call.web-access.character-count', {
				count: value,
				defaultValue_one: '{{count, number}} char',
				defaultValue_other: '{{count, number}} chars',
			});
}

/**
 * Reads string values from an array input.
 * @param value - Untrusted array-shaped input
 * @returns Non-empty strings in original order
 */
function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter(
				(item): item is string =>
					typeof item === 'string' && item.trim().length > 0,
			)
		: [];
}

/**
 * Detects an extension-level error and otherwise renders web prose as markdown.
 * @param part - Web access tool part to project
 * @param raw - Whether successful output should remain raw code
 * @returns Error, empty, raw-code, or markdown body
 */
function webBody(
	part: DynamicToolUIPart,
	raw = false,
): { body: ToolBodyDescriptor; tone: ToolPresenterResult['tone'] } {
	const output = outputOf(part);
	const text = output?.text ?? '';
	const error = stringField(output?.details ?? {}, 'error');
	if (error !== null) {
		return {
			body: { kind: 'error', text: text || error },
			tone: 'destructive',
		};
	}
	if (text.length === 0) {
		return { body: { kind: 'empty' }, tone: 'default' };
	}
	return {
		body: raw
			? textBody(text, 'text' as BundledLanguage)
			: { kind: 'markdown', text },
		tone: 'default',
	};
}

/**
 * Presents a web search by query count and returned result count.
 * @param part - `web_search` tool part
 * @returns Search title, preview, and cited markdown
 */
function presentWebSearch(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const details = outputOf(part)?.details ?? {};
	const queries = stringArray(input.queries);
	const query = stringField(input, 'query');
	const queryCount =
		numberField(details, 'queryCount') ?? (queries.length || (query ? 1 : 0));
	const resultCount = numberField(details, 'totalResults');
	const querySummary =
		queryCount > 1
			? i18n.t('workbench:tool-call.web-access.query-count', {
					count: queryCount,
					defaultValue_one: '{{count}} query',
					defaultValue_other: '{{count}} queries',
				})
			: (query ?? queries[0] ?? null);
	const resultSummary =
		resultCount === null
			? null
			: i18n.t('workbench:tool-call.web-access.result-count', {
					count: resultCount,
					defaultValue_one: '{{count}} result',
					defaultValue_other: '{{count}} results',
				});
	return {
		badge: null,
		...webBody(part),
		preview: webPreview([querySummary, resultSummary]),
		title: i18n.t(
			'workbench:tool-call.web-access.search-title',
			'Search the web',
		),
	};
}

/**
 * Presents a source check by its claim and evidence count.
 * @param part - `source_check` tool part
 * @returns Source-check title, preview, and research artifact
 */
function presentSourceCheck(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const details = outputOf(part)?.details ?? {};
	const sources = numberField(details, 'sourceCount');
	return {
		badge: null,
		...webBody(part),
		preview: webPreview([
			stringField(input, 'claim'),
			sources === null
				? null
				: i18n.t('workbench:tool-call.web-access.source-count', {
						count: sources,
						defaultValue_one: '{{count}} source',
						defaultValue_other: '{{count}} sources',
					}),
		]),
		title: i18n.t(
			'workbench:tool-call.web-access.source-check-title',
			'Check web sources',
		),
	};
}

/**
 * Presents fetched content by page title, URL, and content size.
 * @param part - `fetch_content` tool part
 * @returns Fetch title, preview, and fetched content
 */
function presentFetchContent(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const details = outputOf(part)?.details ?? {};
	const urls = stringArray(input.urls);
	const url = stringField(input, 'url') ?? urls[0] ?? null;
	const urlCount = numberField(details, 'urlCount') ?? urls.length;
	const target =
		urlCount > 1
			? i18n.t('workbench:tool-call.web-access.url-count', {
					count: urlCount,
					defaultValue_one: '{{count}} URL',
					defaultValue_other: '{{count}} URLs',
				})
			: url;
	return {
		badge: null,
		...webBody(part, stringField(input, 'mode') === 'raw'),
		preview: webPreview([
			stringField(details, 'title'),
			target,
			characterCount(numberField(details, 'totalChars')),
		]),
		title: i18n.t(
			'workbench:tool-call.web-access.fetch-title',
			'Fetch web content',
		),
	};
}

/**
 * Presents a bounded lookup into previously stored web content.
 * @param part - `get_search_content` tool part
 * @returns Retrieval title, target preview, and stored content
 */
function presentStoredContent(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const details = outputOf(part)?.details ?? {};
	const findText = stringArray(input.findText);
	const findCount = findText.length || (stringField(input, 'findText') ? 1 : 0);
	const target =
		stringField(details, 'title', 'query', 'url') ??
		stringField(input, 'query', 'url') ??
		stringField(input, 'responseId');
	return {
		badge: null,
		...webBody(part),
		preview: webPreview([
			target,
			findCount > 0
				? i18n.t('workbench:tool-call.web-access.match-query-count', {
						count: findCount,
						defaultValue_one: '{{count}} match query',
						defaultValue_other: '{{count}} match queries',
					})
				: null,
			characterCount(numberField(details, 'returnedChars')),
		]),
		title: i18n.t(
			'workbench:tool-call.web-access.read-title',
			'Read stored web content',
		),
	};
}

/** Dedicated presenters for every pi-web-access tool. */
export const WEB_ACCESS_TOOL_PRESENTERS = {
	fetch_content: presentFetchContent,
	get_search_content: presentStoredContent,
	source_check: presentSourceCheck,
	web_search: presentWebSearch,
} satisfies Record<string, (part: DynamicToolUIPart) => ToolPresenterResult>;
