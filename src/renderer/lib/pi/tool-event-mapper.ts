import type { DynamicToolUIPart } from 'ai';

import type {
	PiSessionEventWire,
	PiWireMessagePart,
	PiWireMessagePayload,
} from '@/shared/ipc';

import type { DynamicToolOutputPart, UIMessagePart } from './types';

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
 * Merges an incoming tool-output part into the existing parts array, pairing
 * it with the prior `input-available` part that shares the same `toolCallId`.
 *
 * Returns `null` when the incoming part is not a tool output — the caller is
 * expected to fall back to whatever handling the part type requires.
 */
export function mergeToolOutputPart(
	existingParts: readonly UIMessagePart[],
	incomingPart: UIMessagePart,
): UIMessagePart[] | null {
	if (!isDynamicToolPart(incomingPart) || !isToolOutputPart(incomingPart)) {
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
export function isDynamicToolPart(
	part: UIMessagePart,
): part is DynamicToolUIPart {
	return part.type === 'dynamic-tool';
}

/** True when a dynamic tool part already carries a tool result. */
export function isToolOutputPart(
	part: DynamicToolUIPart,
): part is DynamicToolOutputPart {
	return part.state === 'output-available' || part.state === 'output-error';
}

function mergeDynamicToolParts(
	previousPart: DynamicToolUIPart,
	incomingPart: DynamicToolOutputPart,
): DynamicToolOutputPart {
	return {
		...incomingPart,
		input: previousPart.input ?? incomingPart.input,
		toolName: previousPart.toolName || incomingPart.toolName,
	};
}

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
