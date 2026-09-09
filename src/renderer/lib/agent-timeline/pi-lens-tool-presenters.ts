import type { DynamicToolUIPart } from 'ai';
import type { BundledLanguage } from 'shiki';
import { i18n } from '@/renderer/lib/i18n';
import type {
	ToolBodyDescriptor,
	ToolGlyph,
	ToolPresenterResult,
	ToolPreviewDescriptor,
} from '@/renderer/types/tool-presentation';
import { classifyToolOutput } from './tool-output-classifier';
import {
	inputOf,
	numberField,
	outputOf,
	pathOf,
	stringField,
} from './tool-part-fields';
import { fileBadge, languageFor, textBody } from './tool-presenter-helpers';

/** Icon assignments for the Pi Lens tools with dedicated presentation. */
export const PI_LENS_TOOL_GLYPHS = {
	lens_diagnostics: 'stethoscope',
	module_report: 'network',
	project_report: 'network',
	read_symbol: 'file-text',
	symbol_search: 'search',
} satisfies Record<string, ToolGlyph>;

/**
 * Reads normalized paths from a tool input that accepts a multi-file scope.
 * @param input - Tool arguments that may carry a `paths` array
 * @returns Non-empty path strings in their original order
 */
function scopedPaths(input: Record<string, unknown>): string[] {
	if (!Array.isArray(input.paths)) {
		return [];
	}
	return input.paths.filter(
		(path): path is string =>
			typeof path === 'string' && path.trim().length > 0,
	);
}

/**
 * Reads the first meaningful line from tool output for a compact row preview.
 * @param text - Full text returned by a tool
 * @returns The first non-empty line, or null when the output is empty
 */
function firstOutputLine(text: string): string | null {
	return (
		text
			.split('\n')
			.map((line) => line.trim())
			.find((line) => line.length > 0) ?? null
	);
}

/**
 * Describes the scope of a running Pi Lens diagnostics call.
 * @param mode - Diagnostic scan mode
 * @param paths - Explicit paths supplied by the call
 * @returns Localized mode and optional path count
 */
function lensDiagnosticsScope(mode: string, paths: readonly string[]): string {
	if (paths.length === 0) {
		return i18n.t(
			'workbench:tool-call.lens-diagnostics.mode',
			'mode={{mode}}',
			{
				mode,
			},
		);
	}
	return i18n.t('workbench:tool-call.lens-diagnostics.scope', {
		count: paths.length,
		defaultValue_one: 'mode={{mode}} · {{count}} path',
		defaultValue_other: 'mode={{mode}} · {{count}} paths',
		mode,
	});
}

/**
 * Presents Pi Lens session diagnostics without repeating a long path array.
 * @param part - The `lens_diagnostics` tool part to project
 * @returns The row's title, optional single-file badge, scope, and report body
 */
function presentLensDiagnostics(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const paths = scopedPaths(input);
	const mode = stringField(input, 'mode') ?? 'delta';
	const text = outputOf(part)?.text ?? '';
	const outputPreview = firstOutputLine(text);
	return {
		badge: fileBadge(paths.length === 1 ? paths[0] : null),
		body:
			text.length === 0
				? { kind: 'empty' }
				: textBody(text, 'text' as BundledLanguage),
		preview:
			outputPreview === null
				? { font: 'mono', text: lensDiagnosticsScope(mode, paths) }
				: { font: 'sans', text: outputPreview },
		title: i18n.t('workbench:tool-call.diagnostics.clean', 'Diagnostics'),
		tone: 'default',
	};
}

/**
 * Presents a Pi Lens project graph report as a focused overview.
 * @param part - The `project_report` tool part to project
 * @returns The row's title, focus preview, and report body
 */
function presentProjectReport(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const text = outputOf(part)?.text ?? '';
	const focus = stringField(input, 'focus');
	return {
		badge: null,
		body:
			text.length === 0
				? { kind: 'empty' }
				: textBody(text, 'text' as BundledLanguage),
		preview: focus === null ? null : { font: 'sans', text: focus },
		title: i18n.t(
			'workbench:tool-call.project-report.title',
			'Project overview',
		),
		tone: 'default',
	};
}

/**
 * Summarizes a module report's inventory for the collapsed row.
 * @param details - Structured counts returned by Pi Lens
 * @returns A localized count summary, or null before counts are available
 */
function moduleReportSummary(
	details: Readonly<Record<string, unknown>> | null,
): string | null {
	if (details === null) {
		return null;
	}
	const symbols = numberField(details, 'symbols');
	const exports = numberField(details, 'exports');
	if (symbols === null || exports === null) {
		return null;
	}
	return [
		i18n.t('workbench:tool-call.module-report.symbols', {
			count: symbols,
			defaultValue_one: '{{count}} symbol',
			defaultValue_other: '{{count}} symbols',
		}),
		i18n.t('workbench:tool-call.module-report.exports', {
			count: exports,
			defaultValue_one: '{{count}} export',
			defaultValue_other: '{{count}} exports',
		}),
	].join(' · ');
}

/**
 * Presents a Pi Lens module overview as a file-scoped outline.
 * @param part - The `module_report` tool part to project
 * @returns The row's title, file badge, summary, and report body
 */
function presentModuleReport(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const output = outputOf(part);
	const text = output?.text ?? '';
	const classification = classifyToolOutput(part.toolName, text);
	const summary = moduleReportSummary(output?.details ?? null);
	const focus = stringField(input, 'focus');
	const previewText = summary ?? focus;
	return {
		badge: fileBadge(pathOf(input)),
		body:
			text.length === 0
				? { kind: 'empty' }
				: textBody(
						classification.text,
						classification.language ?? ('text' as BundledLanguage),
					),
		preview: previewText === null ? null : { font: 'sans', text: previewText },
		title: i18n.t('workbench:tool-call.module-report.title', 'Module outline'),
		tone: 'default',
	};
}

/**
 * Removes Pi Lens's redundant symbol header when metadata identifies source.
 * @param text - Full `read_symbol` result text
 * @param details - Structured symbol metadata returned by Pi Lens
 * @returns Source text and the line number its first line occupies
 */
function readSymbolSource(
	text: string,
	details: Readonly<Record<string, unknown>> | null,
): { code: string; startLine: number | null } {
	if (
		details === null ||
		details.found !== true ||
		details.readRecorded === false
	) {
		return { code: text, startLine: null };
	}
	const startLine = numberField(details, 'startLine', 'start_line');
	const separator = text.indexOf('\n\n');
	if (startLine === null || separator < 0) {
		return { code: text, startLine: null };
	}
	return { code: text.slice(separator + 2), startLine };
}

/**
 * Reads the symbol name from current or persisted tool payloads.
 * @param input - Original tool arguments
 * @param details - Structured result metadata when available
 * @returns Symbol name, or null when neither payload names it
 */
function readSymbolName(
	input: Record<string, unknown>,
	details: Readonly<Record<string, unknown>> | null,
): string | null {
	return (
		(details === null ? null : stringField(details, 'name')) ??
		stringField(input, 'symbol', 'name')
	);
}

/**
 * Builds the optional line-range suffix for a symbol preview.
 * @param details - Structured result metadata when available
 * @returns En-dash line range, or null when either boundary is absent
 */
function readSymbolRange(
	details: Readonly<Record<string, unknown>> | null,
): string | null {
	if (details === null) {
		return null;
	}
	const startLine = numberField(details, 'startLine', 'start_line');
	const endLine = numberField(details, 'endLine', 'end_line');
	return startLine === null || endLine === null
		? null
		: `${startLine}–${endLine}`;
}

/**
 * Builds the compact symbol-and-range preview.
 * @param symbol - Symbol name when known
 * @param range - Source range when complete
 * @returns Monospaced preview descriptor, or null without a symbol
 */
function readSymbolPreview(
	symbol: string | null,
	range: string | null,
): ToolPreviewDescriptor | null {
	if (symbol === null) {
		return null;
	}
	return {
		font: 'mono',
		text: range === null ? symbol : `${symbol} · ${range}`,
	};
}

/**
 * Builds the symbol source body while preserving degraded raw responses.
 * @param source - Source extraction result
 * @param path - File path used to select syntax highlighting
 * @returns Empty body or code body with an optional starting line
 */
function readSymbolBody(
	source: { code: string; startLine: number | null },
	path: string | null,
): ToolBodyDescriptor {
	if (source.code.length === 0) {
		return { kind: 'empty' };
	}
	return {
		code: source.code,
		kind: 'code',
		language: languageFor(path),
		startLine: source.startLine,
	};
}

/**
 * Presents a Pi Lens symbol read as numbered source pinned to its file.
 * @param part - The `read_symbol` tool part to project
 * @returns The row's title, file badge, symbol preview, and source body
 */
function presentReadSymbol(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const output = outputOf(part);
	const details = output?.details ?? null;
	const path = pathOf(input);
	const source = readSymbolSource(output?.text ?? '', details);
	return {
		badge: fileBadge(path),
		body: readSymbolBody(source, path),
		preview: readSymbolPreview(
			readSymbolName(input, details),
			readSymbolRange(details),
		),
		title: i18n.t('workbench:tool-call.read-symbol.title', 'Read symbol'),
		tone: 'default',
	};
}

/**
 * Reads a single path from a symbol-search scope.
 * @param input - The symbol-search input record
 * @returns The only scoped path, or null for an unscoped or multi-path query
 */
function singleSearchScope(input: Record<string, unknown>): string | null {
	const paths = input.paths;
	if (!Array.isArray(paths) || paths.length !== 1) {
		return null;
	}
	const [path] = paths;
	return typeof path === 'string' && path.trim().length > 0 ? path : null;
}

/**
 * Infers the provisional badge kind until the workspace tree resolves it.
 * @param scope - Exact single search scope
 * @returns Folder for an explicitly directory-shaped path, otherwise file
 */
function symbolSearchScopeKind(scope: string): 'file' | 'folder' {
	return scope.trim().endsWith('/') ? 'folder' : 'file';
}

/**
 * Presents Pi Lens symbol search as a scoped query with its ranked results.
 * @param part - The `symbol_search` tool part to project
 * @returns The row's title, optional scope, query preview, and results
 */
function presentSymbolSearch(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const text = outputOf(part)?.text ?? '';
	const query = stringField(input, 'query');
	const scope = singleSearchScope(input);
	return {
		badge:
			scope === null ? null : fileBadge(scope, symbolSearchScopeKind(scope)),
		body:
			text.length === 0
				? { kind: 'empty' }
				: textBody(text, 'text' as BundledLanguage),
		preview: query === null ? null : { font: 'mono', text: query },
		title: i18n.t('workbench:tool-call.symbol-search.title', 'Search symbols'),
		tone: 'default',
	};
}

/** Dedicated presenters for Pi Lens tools. */
export const PI_LENS_TOOL_PRESENTERS = {
	lens_diagnostics: presentLensDiagnostics,
	module_report: presentModuleReport,
	project_report: presentProjectReport,
	read_symbol: presentReadSymbol,
	symbol_search: presentSymbolSearch,
} satisfies Record<string, (part: DynamicToolUIPart) => ToolPresenterResult>;
