import type { DynamicToolUIPart } from 'ai';
import { i18n } from '@/renderer/lib/i18n';
import type {
	TimelineSurface,
	ToolBadgeDescriptor,
	ToolGlyph,
} from '@/renderer/types/tool-presentation';
import {
	BOOKKEEPING_TOOL_NAMES,
	canonicalEnsemblrToolName,
	ENSEMBLR_TOOL_LABELS,
} from './ensemblr-control-tool-registry';
import { inputOf, outputOf } from './tool-part-fields';

/**
 * How the app's own control tools read in the timeline.
 *
 * The label and mark each `ensemblr_*` tool answers to live next door in
 * `ensemblr-control-tool-registry.ts`; this module reads that table against a
 * recorded call — resolving the tense and the surface's vocabulary, folding in
 * the one argument that says what the call acted on, and deciding which rows the
 * timeline omits entirely.
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
 * Narrows a value to a non-array object record.
 * @param value - The value to test
 * @returns True when the value is a plain object
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Narrows a value to the app's control envelope, which is stamped by its boolean
 * `ok` field rather than by any payload key.
 * @param value - The `details` bag carried on a tool result
 * @returns True when the value is a control envelope
 */
function isControlEnvelope(value: unknown): value is {
	code?: unknown;
	data?: unknown;
	error?: unknown;
	ok: boolean;
} {
	return isPlainObject(value) && typeof value.ok === 'boolean';
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
 * Steps one dotted-path segment, reading an array only through `*` — across
 * every element — so a batched call is reachable as the whole set.
 * @param value - The value the walk has reached so far
 * @param segment - The segment to step through
 * @returns The values the segment reaches, empty when it reaches none
 */
function stepPathSegment(value: unknown, segment: string): unknown[] {
	if (Array.isArray(value)) {
		return segment === '*' ? value : [];
	}
	if (typeof value !== 'object' || value === null) {
		return [];
	}
	return [(value as Record<string, unknown>)[segment]];
}

/**
 * Walks a dotted path into a tool call's arguments.
 * @param input - The tool call's input bag
 * @param path - Dotted path, e.g. `comments.*.filePath`
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
 * Reads the payload a successful control call handed back.
 *
 * The two runtimes report the same payload differently: the Pi extension carries
 * the whole envelope on `details`, while the MCP bridge sends only the text it
 * rendered — which for a control op is that payload as JSON. Both are read here
 * so a row does not depend on which runtime happened to make the call.
 * @param part - The tool part to read
 * @returns The payload, or null when the call failed, is still running, or
 * reported something that is not an object
 */
function controlResultData(
	part: DynamicToolUIPart,
): Record<string, unknown> | null {
	const details = detailsOf(part);
	if (isControlEnvelope(details)) {
		return details.ok && isPlainObject(details.data) ? details.data : null;
	}
	return parseObject(outputOf(part)?.text ?? '');
}

/**
 * Reads a JSON object out of a result's text, tolerating anything that is not
 * one — the text is prose for most tools and only happens to be JSON for these.
 * @param text - The result text as the runtime rendered it
 * @returns The parsed object, or null when the text is not one
 */
function parseObject(text: string): Record<string, unknown> | null {
	if (!text.startsWith('{')) {
		return null;
	}
	try {
		const parsed: unknown = JSON.parse(text);
		return isPlainObject(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * Reads the id of the thing a call is about, from its arguments when it was
 * handed one and from its result when it produced one — `create_workspace` and
 * `start_conversation` both learn the id they made only on the way back.
 * @param part - The tool part to read
 * @param keys - Paths to try, in order
 * @returns The id, or null when the call names none
 */
function referencedIdOf(
	part: DynamicToolUIPart,
	keys: readonly string[],
): string | null {
	const bags = [inputOf(part), controlResultData(part)];
	for (const bag of bags) {
		if (bag === null) {
			continue;
		}
		for (const key of keys) {
			const named = agreedPath(valuesAtPath(bag, key));
			if (named !== null) {
				return named;
			}
		}
	}
	return null;
}

/**
 * Resolves the human-readable title, glyph, and chip for a control tool call,
 * folding in the one argument that says which tab, sub-agent, or status it acted
 * on. A call still in flight reads in the present participle, so a blocking wait
 * does not claim to have finished while the turn is still working.
 *
 * The surface picks the vocabulary rather than the tool doing so alone: the same
 * `ensemblr_start_conversation` opens a sub-agent for a workspace agent and a
 * chat the user can talk to for the Concierge.
 *
 * A surface that hands the detail to a chip gets an `unpinnedTitle` back as
 * well, because whether the chip resolves is only known once a component has
 * asked the catalogue — and a row whose chip came up empty has to say what it
 * acted on somewhere.
 * @param part - The tool part to read, arguments and result both
 * @param isRunning - Whether the call has yet to return
 * @param surface - Which transcript the row is being rendered in
 * @returns The title, glyph, and badge, or null when the name is not a control
 * tool
 */
export function ensemblrToolLabel(
	part: DynamicToolUIPart,
	isRunning: boolean,
	surface: TimelineSurface = 'workspace',
): {
	badge: ToolBadgeDescriptor | null;
	glyph: ToolGlyph;
	title: string;
	unpinnedTitle?: string;
} | null {
	const registered = canonicalEnsemblrToolName(part.toolName);
	const label = registered ? ENSEMBLR_TOOL_LABELS[registered] : undefined;
	if (!label) {
		return null;
	}
	const input = inputOf(part);
	const titles =
		surface === 'concierge'
			? (label.conciergeTitle ?? label.title)
			: label.title;
	const action = titles[isRunning ? 1 : 0]();
	const detailKeys =
		surface === 'concierge'
			? (label.conciergeDetailKeys ?? label.detailKeys)
			: label.detailKeys;
	const detail = detailOf(input, detailKeys ?? []);
	const unpinnedDetail = detail ?? detailOf(input, label.detailKeys ?? []);
	return {
		badge: controlBadge(part, label),
		glyph: label.glyph,
		title: titleWithDetail(action, detail),
		...(unpinnedDetail === detail
			? {}
			: { unpinnedTitle: titleWithDetail(action, unpinnedDetail) }),
	};
}

/**
 * Joins an action to the one argument that says what it acted on.
 * @param action - The action, already in the right tense and vocabulary
 * @param detail - The argument, or null when the row names none
 * @returns The row title
 */
function titleWithDetail(action: string, detail: string | null): string {
	return detail
		? i18n.t('workbench:control-tool.with-detail', '{{action}}: {{detail}}', {
				action,
				detail,
			})
		: action;
}

/**
 * Picks the one chip a control row pins, narrowest subject first: the chat it
 * opened, then the workspace holding it, then the file it named. A spawn
 * declares the first two so that a row written before its tab has a name still
 * points somewhere.
 * @param part - The tool part to read
 * @param label - The tool's registry entry
 * @returns The badge, or null when the call named nothing to pin
 */
function controlBadge(
	part: DynamicToolUIPart,
	label: (typeof ENSEMBLR_TOOL_LABELS)[string],
): ToolBadgeDescriptor | null {
	const chatTabId = label.chatKeys
		? referencedIdOf(part, label.chatKeys)
		: null;
	const workspaceId = label.workspaceKeys
		? referencedIdOf(part, label.workspaceKeys)
		: null;
	if (chatTabId !== null) {
		return { chatTabId, kind: 'chat', workspaceId };
	}
	if (workspaceId !== null) {
		return { kind: 'workspace', workspaceId };
	}
	const path = label.pathKeys
		? filePathOf(inputOf(part), label.pathKeys)
		: null;
	return path === null
		? null
		: { additions: null, deletions: null, kind: 'file', path };
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
