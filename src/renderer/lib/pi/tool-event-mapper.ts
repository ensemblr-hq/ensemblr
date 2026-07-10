import type { DynamicToolUIPart } from 'ai';
import type { UIMessagePart } from '@/renderer/types/pi-timeline';
import type {
	PiSessionEventWire,
	PiWireMessagePart,
	PiWireMessagePayload,
} from '@/shared/ipc/contracts/pi-session';

/**
 * Builds an `input-available` dynamic tool part from a Pi `tool-call` payload.
 *
 * Falls back to the wire event id when the tool call does not carry its own
 * id, and to a generic `'tool'` label when the name is missing — these
 * fallbacks keep the part renderable rather than dropping it silently.
 */
export function buildToolCallPart(
	source: Extract<
		PiWireMessagePart | PiWireMessagePayload,
		{ kind: 'tool-call' }
	>,
	event: PiSessionEventWire,
): DynamicToolUIPart {
	const input = isPlainObject(source.input) ? source.input : {};
	return {
		input,
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
 */
export function buildToolResultPart(
	source: Extract<
		PiWireMessagePart | PiWireMessagePayload,
		{ kind: 'tool-result' }
	>,
	event: PiSessionEventWire,
): DynamicToolUIPart {
	const normalizedOutput = normalizeToolOutput(source.output);
	if (source.isError) {
		return {
			errorText: normalizeToolError(normalizedOutput),
			input: {},
			state: 'output-error',
			toolCallId: source.toolCallId || event.id,
			toolName: 'tool',
			type: 'dynamic-tool',
		};
	}
	return {
		input: {},
		output: normalizedOutput,
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
 * winner while preserving the richer input and the more specific tool name.
 * @param previousPart - The part already stored for this tool call
 * @param incomingPart - The newly observed part for the same tool call
 * @returns The merged dynamic-tool part
 */
function mergeDynamicToolParts(
	previousPart: DynamicToolUIPart,
	incomingPart: DynamicToolUIPart,
): DynamicToolUIPart {
	const previousRank = STATE_RANK[previousPart.state] ?? 0;
	const incomingRank = STATE_RANK[incomingPart.state] ?? 0;
	const winner = incomingRank >= previousRank ? incomingPart : previousPart;
	return {
		...winner,
		input: pickRicherInput(previousPart.input, incomingPart.input),
		toolName: pickToolName(previousPart.toolName, incomingPart.toolName),
	} as DynamicToolUIPart;
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
 * Flattens Pi's MCP-style `{ content: [{ text }] }` envelope into plain text,
 * leaving non-envelope values untouched.
 * @param output - The raw tool-result output value
 * @returns The extracted text, or the original value when it is not an envelope
 */
function normalizeToolOutput(output: unknown): unknown {
	if (!output || typeof output !== 'object' || Array.isArray(output)) {
		return output;
	}
	const content = (output as Record<string, unknown>).content;
	if (!Array.isArray(content)) {
		return output;
	}
	const text = content
		.map((block) => {
			if (!block || typeof block !== 'object') {
				return null;
			}
			const value = (block as Record<string, unknown>).text;
			return typeof value === 'string' ? value : null;
		})
		.filter((value): value is string => value !== null)
		.join('\n');
	return text.length > 0 ? text : output;
}

/**
 * Coerces a tool error payload into a displayable message, falling back to a
 * generic failure string.
 * @param output - The normalized error output value
 * @returns A non-empty error message string
 */
function normalizeToolError(output: unknown): string {
	if (typeof output === 'string' && output.length > 0) {
		return output;
	}
	if (output !== undefined && output !== null) {
		try {
			return JSON.stringify(output);
		} catch {
			return 'Tool execution failed.';
		}
	}
	return 'Tool execution failed.';
}

/**
 * Narrows a value to a non-array object record.
 * @param value - The value to test
 * @returns True when `value` is a plain object
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
