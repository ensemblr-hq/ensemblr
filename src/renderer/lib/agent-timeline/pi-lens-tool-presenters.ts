import type { DynamicToolUIPart } from 'ai';
import type { BundledLanguage } from 'shiki';
import { i18n } from '@/renderer/lib/i18n';
import type {
	ToolBodyDescriptor,
	ToolGlyph,
	ToolPresenterResult,
	ToolPreviewDescriptor,
} from '@/renderer/types/tool-presentation';
import { presentLspNavigation } from './pi-lens-lsp-navigation-presenter';
import {
	inputOf,
	numberField,
	outputOf,
	pathOf,
	stringField,
} from './tool-part-fields';
import {
	classifiedToolOutputBody,
	fileBadge,
	languageFor,
	structuredToolOutputBody,
	textBody,
} from './tool-presenter-helpers';

/** Icon assignments for every tool shipped by Pi Lens. */
export const PI_LENS_TOOL_GLYPHS = {
	ast_grep_dump: 'network',
	ast_grep_outline: 'network',
	ast_grep_replace: 'file-pen',
	ast_grep_search: 'search',
	effective_config: 'scroll-text',
	lens_diagnostic_mark: 'stethoscope',
	lens_diagnostics: 'stethoscope',
	lsp_diagnostics: 'stethoscope',
	lsp_navigation: 'crosshair',
	module_report: 'network',
	pi_lens_activate_tools: 'puzzle',
	project_report: 'network',
	read_enclosing: 'file-text',
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
 * Reads an array of non-empty strings from an untrusted field bag.
 * @param input - Tool arguments or details to inspect
 * @param key - Field expected to contain strings
 * @returns Valid strings in their original order
 */
function stringArrayField(
	input: Readonly<Record<string, unknown>>,
	key: string,
): string[] {
	const value = input[key];
	return Array.isArray(value)
		? value.filter(
				(item): item is string =>
					typeof item === 'string' && item.trim().length > 0,
			)
		: [];
}

/**
 * Builds a badge when a path-aware tool was scoped to exactly one target.
 * @param input - Tool arguments carrying `path`, `file`, or `paths`
 * @returns A file or folder badge, or null for broader scopes
 */
function singleScopeBadge(
	input: Readonly<Record<string, unknown>>,
): ToolPresenterResult['badge'] {
	const directPath = pathOf(input as Record<string, unknown>);
	const paths = stringArrayField(input, 'paths');
	const scope = directPath ?? (paths.length === 1 ? paths[0] : null);
	return fileBadge(
		scope,
		scope?.trim().endsWith('/') === true ? 'folder' : 'file',
	);
}

/**
 * Projects free-form Pi Lens output without repeating the input argument bag.
 * @param part - Tool call whose result should become the expandable body
 * @returns Empty, terminal, or syntax-classified body
 */
function piLensOutputBody(part: DynamicToolUIPart): ToolBodyDescriptor {
	return structuredToolOutputBody(part.toolName, outputOf(part)?.text ?? '');
}

/**
 * Joins available preview fragments with the timeline's compact separator.
 * @param parts - Optional fragments in display order
 * @returns Monospaced preview, or null when every fragment is absent
 */
function monoPreview(
	parts: readonly (string | null)[],
): ToolPreviewDescriptor | null {
	const visible = parts.filter((part): part is string => part !== null);
	return visible.length === 0
		? null
		: { font: 'mono', text: visible.join(' · ') };
}

/**
 * Presents activation of Pi Lens's lazily registered tools.
 * @param part - The `pi_lens_activate_tools` call to project
 * @returns A compact capability list with no redundant result body
 */
function presentActivateTools(part: DynamicToolUIPart): ToolPresenterResult {
	const tools = stringArrayField(inputOf(part), 'tools');
	return {
		badge: null,
		body: { kind: 'empty' },
		preview: monoPreview(tools),
		title: i18n.t(
			'workbench:tool-call.pi-lens-activate.title',
			'Activate Pi Lens tools',
		),
		tone: 'default',
	};
}

/**
 * Localizes Pi Lens diagnostic disposition codes for the collapsed row.
 * @param disposition - Runtime disposition code
 * @returns Localized label, or the unknown code unchanged
 */
function diagnosticDisposition(disposition: string | null): string | null {
	switch (disposition) {
		case 'false-positive':
			return i18n.t(
				'workbench:tool-call.diagnostic-mark.false-positive',
				'false positive',
			);
		case 'suppress':
			return i18n.t('workbench:tool-call.diagnostic-mark.suppress', 'suppress');
		case 'defer':
			return i18n.t('workbench:tool-call.diagnostic-mark.defer', 'defer');
		case 'flagged':
			return i18n.t('workbench:tool-call.diagnostic-mark.flagged', 'flagged');
		default:
			return disposition;
	}
}

/**
 * Presents the disposition recorded for one Pi Lens finding.
 * @param part - The `lens_diagnostic_mark` call to project
 * @returns File-scoped disposition, line, and confirmation body
 */
function presentDiagnosticMark(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const disposition = diagnosticDisposition(stringField(input, 'disposition'));
	const line = numberField(input, 'line');
	const lineLabel =
		line === null
			? null
			: i18n.t('workbench:tool-call.diagnostic-mark.line', 'line {{line}}', {
					line,
				});
	const previewParts = [disposition, lineLabel].filter(
		(value): value is string => value !== null,
	);
	return {
		badge: fileBadge(pathOf(input)),
		body: piLensOutputBody(part),
		preview:
			previewParts.length === 0
				? null
				: { font: 'sans', text: previewParts.join(' · ') },
		title: i18n.t(
			'workbench:tool-call.diagnostic-mark.title',
			'Mark diagnostic',
		),
		tone: 'default',
	};
}

/**
 * Reads the most identifying structural query from an AST search call.
 * @param input - AST search arguments
 * @returns Pattern, node kind, or first rule line
 */
function astSearchQuery(input: Record<string, unknown>): string | null {
	const query = stringField(input, 'pattern', 'nodeKind', 'rule');
	return query === null ? null : firstOutputLine(query);
}

/**
 * Presents structural AST matches without serializing the large input bag.
 * @param part - The `ast_grep_search` call to project
 * @returns Search query, optional scope, and match output
 */
function presentAstSearch(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	return {
		badge: singleScopeBadge(input),
		body: piLensOutputBody(part),
		preview: monoPreview([astSearchQuery(input)]),
		title: i18n.t('workbench:tool-call.ast-search.title', 'AST search'),
		tone: 'default',
	};
}

/**
 * Presents an AST rewrite as the pattern-to-replacement transformation.
 * @param part - The `ast_grep_replace` call to project
 * @returns Rewrite preview, optional scope, and match output
 */
function presentAstReplace(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const pattern = stringField(input, 'pattern');
	const rewrite = stringField(input, 'rewrite');
	let transform = pattern;
	if (pattern !== null && rewrite !== null) {
		transform = `${pattern} → ${rewrite}`;
	}
	const details = outputOf(part)?.details;
	const applied =
		typeof details?.applied === 'boolean'
			? details.applied
			: input.apply === true;
	const state = applied
		? i18n.t('workbench:tool-call.ast-replace.applied', 'applied')
		: i18n.t('workbench:tool-call.ast-replace.preview', 'preview');
	return {
		badge: singleScopeBadge(input),
		body: piLensOutputBody(part),
		preview: monoPreview([transform, state]),
		title: i18n.t('workbench:tool-call.ast-replace.title', 'AST replace'),
		tone: 'default',
	};
}

/**
 * Summarizes the number of symbols and files returned by an AST outline.
 * @param details - Structured outline counts
 * @returns Localized compact count summary
 */
function astOutlineSummary(
	details: Readonly<Record<string, unknown>> | null,
): string | null {
	if (details === null) {
		return null;
	}
	const symbols = numberField(details, 'items');
	const files = numberField(details, 'files');
	if (symbols === null || files === null) {
		return null;
	}
	return [
		i18n.t('workbench:tool-call.module-report.symbols', {
			count: symbols,
			defaultValue_one: '{{count}} symbol',
			defaultValue_other: '{{count}} symbols',
		}),
		i18n.t('workbench:tool-call.ast-outline.files', {
			count: files,
			defaultValue_one: '{{count}} file',
			defaultValue_other: '{{count}} files',
		}),
	].join(' · ');
}

/**
 * Presents a syntax-only AST outline with its returned inventory.
 * @param part - The `ast_grep_outline` call to project
 * @returns Scope, count preview, and JSON outline body
 */
function presentAstOutline(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const output = outputOf(part);
	return {
		badge: singleScopeBadge(input),
		body: piLensOutputBody(part),
		preview: monoPreview([
			astOutlineSummary(output?.details ?? null) ?? stringField(input, 'view'),
		]),
		title: i18n.t('workbench:tool-call.ast-outline.title', 'Syntax outline'),
		tone: 'default',
	};
}

/**
 * Presents a tree-sitter AST dump by language and source snippet.
 * @param part - The `ast_grep_dump` call to project
 * @returns Language/source preview and textual AST body
 */
function presentAstDump(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const language =
		stringField(outputOf(part)?.details ?? {}, 'lang') ??
		stringField(input, 'lang');
	const source = stringField(input, 'source');
	return {
		badge: null,
		body: piLensOutputBody(part),
		preview: monoPreview([
			language,
			source === null ? null : firstOutputLine(source),
		]),
		title: i18n.t('workbench:tool-call.ast-dump.title', 'AST dump'),
		tone: 'default',
	};
}

/**
 * Builds the compact file-specific summary for effective configuration.
 * @param details - Effective-config result metadata
 * @returns Localized document/server counts, or null before completion
 */
function effectiveConfigSummary(
	details: Readonly<Record<string, unknown>> | null,
): string | null {
	if (details === null) {
		return null;
	}
	const documents = numberField(details, 'documents');
	const servers = numberField(details, 'selectedServers');
	if (documents === null) {
		return null;
	}
	const parts: string[] = [
		i18n.t('workbench:tool-call.effective-config.files', {
			count: documents,
			defaultValue_one: '{{count}} config file',
			defaultValue_other: '{{count}} config files',
		}),
	];
	if (servers !== null) {
		parts.push(
			i18n.t('workbench:tool-call.effective-config.servers', {
				count: servers,
				defaultValue_one: '{{count}} server selected',
				defaultValue_other: '{{count}} servers selected',
			}),
		);
	}
	return parts.join(' · ');
}

/**
 * Removes the effective-config summary line before rendering its JSON body.
 * @param text - Summary followed by the serialized resolved configuration
 * @returns The serialized body, or the original output when not sectioned
 */
function effectiveConfigBody(text: string): string {
	const separator = text.indexOf('\n\n');
	return separator < 0 ? text : text.slice(separator + 2);
}

/**
 * Presents Pi Lens configuration provenance for the optional target file.
 * @param part - The `effective_config` call to project
 * @returns File scope, selected counts, and serialized provenance body
 */
function presentEffectiveConfig(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const output = outputOf(part);
	const text = effectiveConfigBody(output?.text ?? '');
	const summary = effectiveConfigSummary(output?.details ?? null);
	return {
		badge: fileBadge(stringField(input, 'file')),
		body: structuredToolOutputBody(part.toolName, text),
		preview: summary === null ? null : { font: 'sans', text: summary },
		title: i18n.t(
			'workbench:tool-call.effective-config.title',
			'Effective config',
		),
		tone: 'default',
	};
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
	const summary = moduleReportSummary(output?.details ?? null);
	const focus = stringField(input, 'focus');
	const previewText = summary ?? focus;
	return {
		badge: fileBadge(pathOf(input)),
		body:
			text.length === 0
				? { kind: 'empty' }
				: classifiedToolOutputBody(part.toolName, text),
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
 * Presents a Pi Lens symbol or enclosing-source read pinned to its file.
 * @param part - The `read_symbol` or `read_enclosing` tool part to project
 * @returns The row's title, file badge, symbol preview, and source body
 */
function presentSourceRead(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const output = outputOf(part);
	const details = output?.details ?? null;
	const path = pathOf(input);
	const source = readSymbolSource(output?.text ?? '', details);
	const readsEnclosing = part.toolName.toLowerCase() === 'read_enclosing';
	return {
		badge: fileBadge(path),
		body: readSymbolBody(source, path),
		preview: readSymbolPreview(
			readSymbolName(input, details),
			readSymbolRange(details),
		),
		title: readsEnclosing
			? i18n.t('workbench:tool-call.read-enclosing.title', 'Read enclosing')
			: i18n.t('workbench:tool-call.read-symbol.title', 'Read symbol'),
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

/** Dedicated presenters for every Pi Lens tool except shared LSP diagnostics. */
export const PI_LENS_TOOL_PRESENTERS = {
	ast_grep_dump: presentAstDump,
	ast_grep_outline: presentAstOutline,
	ast_grep_replace: presentAstReplace,
	ast_grep_search: presentAstSearch,
	effective_config: presentEffectiveConfig,
	lens_diagnostic_mark: presentDiagnosticMark,
	lens_diagnostics: presentLensDiagnostics,
	lsp_navigation: presentLspNavigation,
	module_report: presentModuleReport,
	pi_lens_activate_tools: presentActivateTools,
	project_report: presentProjectReport,
	read_enclosing: presentSourceRead,
	read_symbol: presentSourceRead,
	symbol_search: presentSymbolSearch,
} satisfies Record<string, (part: DynamicToolUIPart) => ToolPresenterResult>;
