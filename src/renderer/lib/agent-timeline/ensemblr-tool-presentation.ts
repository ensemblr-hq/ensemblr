import type { DynamicToolUIPart } from 'ai';
import { i18n } from '@/renderer/lib/i18n';
import type {
	ToolBadgeDescriptor,
	ToolGlyph,
} from '@/renderer/types/tool-presentation';
import {
	BOOKKEEPING_TOOL_NAMES,
	canonicalEnsemblrToolName,
	ENSEMBLR_TOOL_LABELS,
} from './ensemblr-control-tool-registry';

/**
 * How the app's own control tools read in the timeline.
 *
 * The label and mark each `ensemblr_*` tool answers to live next door in
 * `ensemblr-control-tool-registry.ts`; this module reads that table against a
 * recorded call — resolving the tense, folding in the one argument that says
 * what the call acted on, and deciding which rows the timeline omits entirely.
 *
 * A failed call is never hidden. The denial codes these tools return —
 * `denied-permission`, `denied-scope`, `invalid-args` — are exactly what a user
 * needs to see, so only a call that succeeded disappears. A refusal reaches the
 * timeline as an ordinary result rather than as a transport error, so it is the
 * `{ ok: false }` envelope on the result's `details`, not the error text, that
 * separates the two.
 *
 * Every lookup here goes through {@link canonicalEnsemblrToolName} rather than
 * the reported name, because only one of the two runtimes reports the name the
 * control extension registered.
 */

export {
	canonicalEnsemblrToolName,
	ENSEMBLR_CONTROL_TOOL_NAMES,
} from './ensemblr-control-tool-registry';

/** Longest detail suffix kept on a title before it crowds the row. */
const MAX_DETAIL_LENGTH = 48;

/**
 * Why the app refused a control call, as the call itself reported it.
 *
 * The control channel answers a refusal with `{ ok: false, code, error }` on the
 * result's `details` and leaves the transport's error flag unset, so this is the
 * only signal a denial ever raises.
 */
export interface EnsemblrControlFailure {
	/** Denial code, e.g. `denied-permission`; null when the envelope omits one. */
	code: string | null;
	/** The reason to show the user; null when the envelope gave none. */
	error: string | null;
}

/**
 * Narrows a value to the app's control envelope, which is stamped by its boolean
 * `ok` field rather than by any payload key.
 * @param value - The `details` bag carried on a tool result
 * @returns True when the value is a control envelope
 */
function isControlEnvelope(
	value: unknown,
): value is { code?: unknown; error?: unknown; ok: boolean } {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		'ok' in value &&
		typeof value.ok === 'boolean'
	);
}

/**
 * Reads the `details` bag a tool result carries, tolerating the pre-envelope
 * shape where `output` held a bare string.
 * @param part - The tool part to read
 * @returns The details value, or null when the result carries none
 */
function detailsOf(part: DynamicToolUIPart): unknown {
	if (!('output' in part)) {
		return null;
	}
	const output = part.output;
	if (typeof output !== 'object' || output === null || !('details' in output)) {
		return null;
	}
	return output.details;
}

/**
 * Reads the refusal a control call reported inside an otherwise ordinary result.
 *
 * Only the app's own tools are read this way: an `ok` field on any other tool's
 * payload is that tool's business and says nothing about a denial.
 * @param part - The tool part to inspect
 * @returns The reported failure, or null when this is not a refused control call
 */
export function ensemblrControlFailure(
	part: DynamicToolUIPart,
): EnsemblrControlFailure | null {
	if (canonicalEnsemblrToolName(part.toolName) === null) {
		return null;
	}
	const details = detailsOf(part);
	if (!isControlEnvelope(details) || details.ok) {
		return null;
	}
	return {
		code: nonEmptyString(details.code),
		error: nonEmptyString(details.error),
	};
}

/**
 * Keeps a value only when it is a string with something in it.
 * @param value - The envelope field to read
 * @returns The string, or null when it is absent or blank
 */
function nonEmptyString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Whether a tool call is the app's own bookkeeping and should not be rendered.
 * A failed call always renders, so a denial or a malformed argument stays
 * visible — including the denials the control channel reports as a normal
 * result carrying `ok: false`.
 * @param part - The tool part to classify
 * @returns True when the row should be omitted from the timeline
 */
export function isHiddenEnsemblrToolCall(part: DynamicToolUIPart): boolean {
	if ('errorText' in part && part.errorText) {
		return false;
	}
	if (ensemblrControlFailure(part) !== null) {
		return false;
	}
	const registered = canonicalEnsemblrToolName(part.toolName);
	return registered !== null && BOOKKEEPING_TOOL_NAMES.has(registered);
}

/**
 * Steps one dotted-path segment, reading an array by numeric index or, on `*`,
 * across every element, so a batched call is reachable either by its first item
 * or as the whole set.
 * @param value - The value the walk has reached so far
 * @param segment - The segment to step through
 * @returns The values the segment reaches, empty when it reaches none
 */
function stepPathSegment(value: unknown, segment: string): unknown[] {
	if (Array.isArray(value)) {
		return segment === '*' ? value : [value[Number(segment)]];
	}
	if (typeof value !== 'object' || value === null) {
		return [];
	}
	return [(value as Record<string, unknown>)[segment]];
}

/**
 * Walks a dotted path into a tool call's arguments.
 * @param input - The tool call's input bag
 * @param path - Dotted path, e.g. `comments.0.filePath` or `comments.*.filePath`
 * @returns Every value the path reaches, in order; empty when a segment is
 * missing
 */
function valuesAtPath(input: Record<string, unknown>, path: string): unknown[] {
	return path
		.split('.')
		.reduce<unknown[]>(
			(reached, segment) =>
				reached.flatMap((value) => stepPathSegment(value, segment)),
			[input],
		);
}

/**
 * Reads the first non-empty string among the given input paths, trimmed to a
 * length that fits a row title.
 * @param input - The tool call's input bag
 * @param keys - Input paths to try, in order
 * @returns The detail to append to the title, or null when none is usable
 */
function detailOf(
	input: Record<string, unknown>,
	keys: readonly string[],
): string | null {
	for (const key of keys) {
		const value = valuesAtPath(input, key)[0];
		if (typeof value !== 'string') {
			continue;
		}
		const collapsed = value.replace(/\s+/g, ' ').trim();
		if (collapsed.length === 0) {
			continue;
		}
		return collapsed.length > MAX_DETAIL_LENGTH
			? `${collapsed.slice(0, MAX_DETAIL_LENGTH).trimEnd()}…`
			: collapsed;
	}
	return null;
}

/**
 * Reads the one file a path's values agree on, ignoring the items that named
 * none.
 * @param values - The values a path reached
 * @returns The agreed path, or null when they name none or disagree
 */
function agreedPath(values: readonly unknown[]): string | null {
	const named = new Set<string>();
	for (const value of values) {
		if (typeof value === 'string' && value.trim().length > 0) {
			named.add(value.trim());
		}
	}
	return named.size === 1 ? [...named][0] : null;
}

/**
 * Reads the workspace file a call named, for the row to pin as a chip rather
 * than spell out in its title. Never shortened, unlike {@link detailOf} — the
 * chip paints a basename and holds the whole path behind it.
 *
 * A batched path such as `comments.*.filePath` earns a chip only when every item
 * names the same file: one call files comments across as many files as the
 * reviewer touched, so pinning the first would label the row with a file most of
 * its body is not about.
 * @param input - The tool call's input bag
 * @param keys - Input paths to try, in order
 * @returns The path the call named, or null when none is usable
 */
function filePathOf(
	input: Record<string, unknown>,
	keys: readonly string[],
): string | null {
	for (const key of keys) {
		const named = agreedPath(valuesAtPath(input, key));
		if (named !== null) {
			return named;
		}
	}
	return null;
}

/**
 * Resolves the human-readable title, glyph, and file chip for a control tool
 * call, folding in the one argument that says which tab, sub-agent, or status it
 * acted on. A call still in flight reads in the present participle, so a
 * blocking wait does not claim to have finished while the turn is still working.
 * @param toolName - The tool name as the runtime reported it
 * @param input - The tool call's input bag
 * @param isRunning - Whether the call has yet to return
 * @returns The title, glyph, and badge, or null when the name is not a control
 * tool
 */
export function ensemblrToolLabel(
	toolName: string,
	input: Record<string, unknown>,
	isRunning: boolean,
): {
	badge: ToolBadgeDescriptor | null;
	glyph: ToolGlyph;
	title: string;
} | null {
	const registered = canonicalEnsemblrToolName(toolName);
	const label = registered ? ENSEMBLR_TOOL_LABELS[registered] : undefined;
	if (!label) {
		return null;
	}
	const action = label.title[isRunning ? 1 : 0]();
	const path = label.pathKeys ? filePathOf(input, label.pathKeys) : null;
	const detail = label.detailKeys ? detailOf(input, label.detailKeys) : null;
	return {
		badge:
			path === null
				? null
				: { additions: null, deletions: null, kind: 'file', path },
		glyph: label.glyph,
		title: detail
			? i18n.t('workbench:control-tool.with-detail', '{{action}}: {{detail}}', {
					action,
					detail,
				})
			: action,
	};
}

/**
 * Resolves a control tool's glyph without reading its arguments, for the summary
 * strip that paints one mark per folded call.
 * @param toolName - The tool name as the runtime reported it
 * @returns The glyph, or null when the name is not a control tool
 */
export function ensemblrToolGlyph(toolName: string): ToolGlyph | null {
	const registered = canonicalEnsemblrToolName(toolName);
	return registered ? (ENSEMBLR_TOOL_LABELS[registered]?.glyph ?? null) : null;
}
