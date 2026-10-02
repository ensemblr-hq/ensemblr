import type { DynamicToolUIPart } from 'ai';
import { i18n } from '@/renderer/lib/i18n';
import type {
	ToolGlyph,
	ToolPresenterResult,
	ToolPreviewDescriptor,
} from '@/renderer/types/tool-presentation';
import { inputOf, outputOf, stringField } from './tool-part-fields';

/** Icon assignments for Context7 documentation tools. */
export const CONTEXT7_TOOL_GLYPHS = {
	context7_get_cached_doc_raw: 'scroll-text',
	context7_get_library_docs: 'scroll-text',
	context7_resolve_library_id: 'scroll-text',
} satisfies Record<string, ToolGlyph>;

/**
 * Detects a Context7 failure carried in structured result details.
 * @param part - Context7 tool part whose details should be inspected
 * @returns True when the result includes an error field
 */
function hasContext7Error(part: DynamicToolUIPart): boolean {
	const details = outputOf(part)?.details;
	return (
		details !== null && details !== undefined && details.error !== undefined
	);
}

/**
 * Builds a Context7 preview from the meaningful values in display order.
 * @param values - Optional preview values to join
 * @param font - Typography for prose or machine-readable identifiers
 * @returns A preview descriptor, or null when no values are available
 */
function context7Preview(
	values: readonly (string | null)[],
	font: 'mono' | 'sans',
): ToolPreviewDescriptor | null {
	const visibleValues = values.filter(
		(value): value is string => value !== null,
	);
	return visibleValues.length === 0
		? null
		: { font, text: visibleValues.join(' · ') };
}

/**
 * Projects Context7 markdown output and structured failures into a shared row shape.
 * @param part - Context7 tool part to project
 * @param title - Localized activity title
 * @param preview - Collapsed request and result summary
 * @returns A complete Context7 presenter result
 */
function presentContext7Output(
	part: DynamicToolUIPart,
	title: string,
	preview: ToolPreviewDescriptor | null,
): ToolPresenterResult {
	const text = outputOf(part)?.text ?? '';
	if (hasContext7Error(part)) {
		return {
			badge: null,
			body: { kind: 'error', text },
			preview,
			title,
			tone: 'destructive',
		};
	}
	return {
		badge: null,
		body: text.length === 0 ? { kind: 'empty' } : { kind: 'markdown', text },
		preview,
		title,
		tone: 'default',
	};
}

/**
 * Presents Context7 library resolution with the requested and resolved identifiers.
 * @param part - The `context7_resolve_library_id` tool part to project
 * @returns The requested library, resolved identifier, and result markdown
 */
function presentContext7Resolve(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const details = outputOf(part)?.details ?? {};
	return presentContext7Output(
		part,
		i18n.t(
			'workbench:tool-call.context7.resolve-title',
			'Resolve Context7 library',
		),
		context7Preview(
			[stringField(input, 'libraryName'), stringField(details, 'libraryId')],
			'mono',
		),
	);
}

/**
 * Presents freshly fetched Context7 documentation without repeating input JSON.
 * @param part - The `context7_get_library_docs` tool part to project
 * @returns The library/query preview and documentation markdown
 */
function presentContext7Docs(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const details = outputOf(part)?.details;
	const cacheHit =
		details?.cached === true
			? i18n.t('workbench:tool-call.context7.cache-hit', 'cache hit')
			: null;
	return presentContext7Output(
		part,
		i18n.t('workbench:tool-call.context7.fetch-title', 'Fetch Context7 docs'),
		context7Preview(
			[stringField(input, 'libraryId'), stringField(input, 'query'), cacheHit],
			'sans',
		),
	);
}

/**
 * Checks whether cached Context7 details report an exact or prefix match.
 * @param part - Cached-document tool part to inspect
 * @returns True when Context7 found an exact or prefix cache entry
 */
function isContext7CacheHit(part: DynamicToolUIPart): boolean {
	const match = stringField(outputOf(part)?.details ?? {}, 'match');
	return match === 'exact' || match === 'prefix';
}

/**
 * Presents cached Context7 documentation and marks confirmed cache hits.
 * @param part - The `context7_get_cached_doc_raw` tool part to project
 * @returns The cache lookup preview and documentation markdown
 */
function presentCachedContext7Docs(
	part: DynamicToolUIPart,
): ToolPresenterResult {
	const input = inputOf(part);
	const cacheHit = isContext7CacheHit(part)
		? i18n.t('workbench:tool-call.context7.cache-hit', 'cache hit')
		: null;
	return presentContext7Output(
		part,
		i18n.t(
			'workbench:tool-call.context7.cached-title',
			'Read cached Context7 docs',
		),
		context7Preview(
			[stringField(input, 'libraryId'), stringField(input, 'query'), cacheHit],
			'sans',
		),
	);
}

/** Dedicated presenters for the complete Context7 tool surface. */
export const CONTEXT7_TOOL_PRESENTERS = {
	context7_get_cached_doc_raw: presentCachedContext7Docs,
	context7_get_library_docs: presentContext7Docs,
	context7_resolve_library_id: presentContext7Resolve,
} satisfies Record<string, (part: DynamicToolUIPart) => ToolPresenterResult>;
