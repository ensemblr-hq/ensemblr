import type { DynamicToolUIPart } from 'ai';
import { i18n } from '@/renderer/lib/i18n';
import type {
	AgentToolOutput,
	ParentedDynamicToolUIPart,
	UIMessagePart,
} from '@/renderer/types/agent-timeline';
import type {
	AgentSessionEventWire,
	AgentWireMessagePart,
	AgentWireMessagePayload,
} from '@/shared/ipc/contracts/agent-session';
import { parentToolCallIdOf } from './subagent-parts.ts';

/**
 * Builds an `input-available` dynamic tool part from a Pi `tool-call` payload.
 *
 * Falls back to the wire event id when the tool call does not carry its own
 * id, and to a generic `'tool'` label when the name is missing — these
 * fallbacks keep the part renderable rather than dropping it silently.
 * @param source - The wire `tool-call` part or payload
 * @param event - The persisted event frame the call arrived on
 * @param parentToolCallId - Tool call whose subagent made this one, or null on the main thread
 * @returns The `input-available` dynamic tool part
 */
export function buildToolCallPart(
	source: Extract<
		AgentWireMessagePart | AgentWireMessagePayload,
		{ kind: 'tool-call' }
	>,
	event: AgentSessionEventWire,
	parentToolCallId: string | null = null,
): ParentedDynamicToolUIPart {
	const input = isPlainObject(source.input) ? source.input : {};
	return {
		input,
		...(parentToolCallId ? { parentToolCallId } : {}),
		state: 'input-available',
		toolCallId: source.toolCallId || event.id,
		toolName: source.name || 'tool',
		type: 'dynamic-tool',
	};
}

/**
 * Builds an `output-available` or `output-error` dynamic tool part from a Pi
 * `tool-result` payload. The output is normalized before being attached so the
 * UI does not have to peer into Pi's MCP-style `{ content: [...] }` envelope.
 * @param source - The wire `tool-result` part or payload
 * @param event - The persisted event frame the result arrived on
 * @param parentToolCallId - Tool call whose subagent produced this result, or null on the main thread
 * @returns The settled dynamic tool part
 */
export function buildToolResultPart(
	source: Extract<
		AgentWireMessagePart | AgentWireMessagePayload,
		{ kind: 'tool-result' }
	>,
	event: AgentSessionEventWire,
	parentToolCallId: string | null = null,
): ParentedDynamicToolUIPart {
	const normalizedOutput = normalizeToolOutput(source.output);
	const link = parentToolCallId ? { parentToolCallId } : {};
	if (source.isError) {
		return {
			errorText: normalizeToolError(normalizedOutput),
			input: {},
			...link,
			state: 'output-error',
			toolCallId: source.toolCallId || event.id,
			toolName: 'tool',
			type: 'dynamic-tool',
		};
	}
	return {
		input: {},
		output: normalizedOutput,
		...link,
		state: 'output-available',
		toolCallId: source.toolCallId || event.id,
		toolName: 'tool',
		type: 'dynamic-tool',
	};
}

/**
 * Merges any incoming `dynamic-tool` part into the existing parts array keyed
 * by `toolCallId`. The Pi runtime emits each tool call twice — once as a
 * streaming `tool-call`/`tool-result` event and again inside the final
 * authoritative `message` envelope — so without this dedup every call renders
 * as a duplicate row.
 *
 * Merge rules: results win over calls (state precedence output-error >
 * output-available > input-available), the non-empty `input` survives, and a
 * concrete tool name beats the generic `'tool'` fallback.
 *
 * Returns `null` when the incoming part is not a dynamic-tool part — the
 * caller falls back to whatever handling the part type requires.
 */
export function mergeToolPart(
	existingParts: readonly UIMessagePart[],
	incomingPart: UIMessagePart,
): UIMessagePart[] | null {
	if (!isDynamicToolPart(incomingPart)) {
		return null;
	}

	const merged: UIMessagePart[] = [...existingParts];
	const matchIndex = merged.findIndex(
		(part) =>
			isDynamicToolPart(part) && part.toolCallId === incomingPart.toolCallId,
	);
	if (matchIndex === -1) {
		merged.push(incomingPart);
		return merged;
	}

	const previousPart = merged[matchIndex];
	if (previousPart !== undefined && isDynamicToolPart(previousPart)) {
		merged[matchIndex] = mergeDynamicToolParts(previousPart, incomingPart);
	}
	return merged;
}

/** True when `part` is the `dynamic-tool` variant. */
function isDynamicToolPart(part: UIMessagePart): part is DynamicToolUIPart {
	return part.type === 'dynamic-tool';
}

const STATE_RANK: Record<string, number> = {
	'input-available': 1,
	'input-streaming': 0,
	'output-available': 2,
	'output-error': 3,
};

/**
 * Combines two dynamic-tool parts for the same call, keeping the higher-state
 * winner while preserving the richer input, the more specific tool name, and the
 * subagent link.
 *
 * The link is carried explicitly because a result normally outranks the call it
 * settles and is built without one, so spreading the winner alone would drop the
 * nesting the moment a subagent's tool finished.
 * @param previousPart - The part already stored for this tool call
 * @param incomingPart - The newly observed part for the same tool call
 * @returns The merged dynamic-tool part
 */
function mergeDynamicToolParts(
	previousPart: DynamicToolUIPart,
	incomingPart: DynamicToolUIPart,
): ParentedDynamicToolUIPart {
	const previousRank = STATE_RANK[previousPart.state] ?? 0;
	const incomingRank = STATE_RANK[incomingPart.state] ?? 0;
	const winner = incomingRank >= previousRank ? incomingPart : previousPart;
	const parentToolCallId =
		parentToolCallIdOf(previousPart) ?? parentToolCallIdOf(incomingPart);
	return {
		...winner,
		...(parentToolCallId ? { parentToolCallId } : {}),
		input: pickRicherInput(previousPart.input, incomingPart.input),
		toolName: pickToolName(previousPart.toolName, incomingPart.toolName),
	} as ParentedDynamicToolUIPart;
}

/**
 * Chooses whichever tool input carries object keys, preferring the first.
 * @param a - The previously stored input value
 * @param b - The incoming input value
 * @returns The input that has keys, or a fallback when neither does
 */
function pickRicherInput(a: unknown, b: unknown): unknown {
	const aHasKeys =
		a !== null && typeof a === 'object' && Object.keys(a).length > 0;
	if (aHasKeys) {
		return a;
	}
	const bHasKeys =
		b !== null && typeof b === 'object' && Object.keys(b).length > 0;
	return bHasKeys ? b : (a ?? b);
}

/**
 * Prefers a concrete tool name over the generic `'tool'` fallback.
 * @param a - The previously stored tool name
 * @param b - The incoming tool name
 * @returns The most specific of the two names
 */
function pickToolName(a: string, b: string): string {
	if (a && a !== 'tool') {
		return a;
	}
	if (b && b !== 'tool') {
		return b;
	}
	return a || b;
}

/**
 * Flattens Pi's MCP-style `{ content: [{ text }], details }` envelope into the
 * renderer's tool-output shape: joined text plus the tool-specific details bag.
 *
 * Values arriving outside the envelope (a bare string, a plain object) are
 * stringified into `text` with no details, so every consumer sees one shape.
 * @param output - The raw tool-result output value
 * @returns The normalized text and details for this result
 */
function normalizeToolOutput(output: unknown): AgentToolOutput {
	if (!isPlainObject(output)) {
		return { details: null, text: stringifyOutput(output) };
	}
	const details = isPlainObject(output.details) ? output.details : null;
	if (!Array.isArray(output.content)) {
		return { details, text: stringifyOutput(details ? null : output) };
	}
	const text = output.content
		.map((block) =>
			isPlainObject(block) && typeof block.text === 'string'
				? block.text
				: null,
		)
		.filter((value): value is string => value !== null)
		.join('\n');
	return { details, text };
}

/**
 * Renders any non-envelope tool payload as text without throwing.
 * @param value - The raw payload
 * @returns The payload as text, or an empty string when there is nothing to show
 */
function stringifyOutput(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	if (value === undefined || value === null) {
		return '';
	}
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

/**
 * Coerces a normalized tool failure into a displayable message, falling back to
 * a generic failure string.
 * @param output - The normalized error output
 * @returns A non-empty error message string
 */
function normalizeToolError(output: AgentToolOutput): string {
	return output.text.length > 0
		? output.text
		: i18n.t('workbench:tool-call.failed.generic', 'Tool execution failed.');
}

/**
 * Narrows a value to a non-array object record.
 * @param value - The value to test
 * @returns True when `value` is a plain object
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
