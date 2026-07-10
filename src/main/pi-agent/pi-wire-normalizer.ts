import type {
	PiAgentMessagePart,
	PiAgentMessagePayload,
} from './pi-agent-types.ts';

/**
 * Type guard for a known Pi wire message role.
 * @param value - Candidate role value from a wire frame
 * @returns True when `value` is `agent`, `tool`, or `user`
 */
export function isMessageRole(
	value: unknown,
): value is 'agent' | 'tool' | 'user' {
	return value === 'agent' || value === 'tool' || value === 'user';
}

/**
 * Reads the string `id` from an unknown Pi message frame.
 * @param message - Candidate message object from the wire
 * @returns The message id, or null when absent or not a string
 */
export function extractMessageId(message: unknown): string | null {
	if (!message || typeof message !== 'object') {
		return null;
	}
	const id = (message as Record<string, unknown>).id;
	return typeof id === 'string' ? id : null;
}

/**
 * Normalizes a Pi `message_end` frame into the tagged-union payload consumed
 * downstream. Pi's wire shape uses a `role` plus a `content[]` of typed
 * blocks; we collapse the role and project blocks to typed parts.
 */
export function normalizeMessageEnd(
	message: Record<string, unknown>,
	wireRole: 'agent' | 'tool' | 'user',
): PiAgentMessagePayload {
	const role: 'assistant' | 'user' = wireRole === 'user' ? 'user' : 'assistant';
	const parts = normalizeContentParts(message.content);
	return { kind: 'message', parts, role };
}

/**
 * Projects Pi's `content: [{type:'text'|'thinking'|'toolCall', ...}]` array
 * into structured {@link PiAgentMessagePart} entries. Blocks we don't know how
 * to interpret are skipped.
 */
export function normalizeContentParts(
	content: unknown,
): readonly PiAgentMessagePart[] {
	if (typeof content === 'string') {
		return content.length > 0 ? [{ kind: 'text', text: content }] : [];
	}
	if (!Array.isArray(content)) {
		return [];
	}
	const parts: PiAgentMessagePart[] = [];
	for (const block of content) {
		const part = contentBlockToPart(block);
		if (part) {
			parts.push(part);
		}
	}
	return parts;
}

/**
 * Converts a single Pi content block into a typed message part.
 * @param block - One entry from a Pi message `content[]` array
 * @returns The mapped part, or null for blocks that are not modelled
 */
export function contentBlockToPart(block: unknown): PiAgentMessagePart | null {
	if (!block || typeof block !== 'object') {
		return null;
	}
	const record = block as Record<string, unknown>;
	const blockType = typeof record.type === 'string' ? record.type : '';
	if (blockType === 'text' && typeof record.text === 'string') {
		return { kind: 'text', text: record.text };
	}
	if (blockType === 'thinking' && typeof record.thinking === 'string') {
		return { kind: 'reasoning', text: record.thinking };
	}
	if (blockType === 'toolCall' || blockType === 'tool-call') {
		const name = typeof record.name === 'string' ? record.name : 'tool';
		const id =
			typeof record.id === 'string' && record.id.length > 0 ? record.id : name;
		const input =
			record.arguments &&
			typeof record.arguments === 'object' &&
			!Array.isArray(record.arguments)
				? (record.arguments as Record<string, unknown>)
				: {};
		return { input, kind: 'tool-call', name, toolCallId: id };
	}
	return null;
}

/**
 * Normalizes Pi's `tool_execution_start | tool_execution_update |
 * tool_execution_end` frames. `_end` produces a `tool-result`; the in-progress
 * variants produce a `tool-call` so the renderer can show an
 * input-available/input-streaming state.
 */
export function normalizeToolExecutionFrame(
	typed: Record<string, unknown>,
): PiAgentMessagePayload {
	const toolCallId =
		typeof typed.toolCallId === 'string' && typed.toolCallId.length > 0
			? typed.toolCallId
			: 'tool-call';
	const name =
		typeof typed.toolName === 'string' && typed.toolName.length > 0
			? typed.toolName
			: 'tool';
	if (typed.type === 'tool_execution_end') {
		const output = typed.result ?? typed.partialResult;
		return {
			isError: typed.isError === true,
			kind: 'tool-result',
			output,
			toolCallId,
		};
	}
	return {
		input: typed.args ?? {},
		kind: 'tool-call',
		name,
		toolCallId,
	};
}

/**
 * Normalizes the legacy `tool_call` / `tool_result` / `message` shapes still
 * produced by older Pi runtimes (and exercised in tests). Falls back to a
 * generic `unknown` envelope when we cannot extract anything useful so the
 * renderer can render a system-notice instead of crashing on shape mismatch.
 */
export function normalizeLegacyMessageFrame(
	typed: Record<string, unknown>,
	wireRole: 'agent' | 'tool' | 'user',
): PiAgentMessagePayload {
	const inner =
		typed.payload &&
		typeof typed.payload === 'object' &&
		!Array.isArray(typed.payload)
			? (typed.payload as Record<string, unknown>)
			: typed;

	if (wireRole === 'tool') {
		const toolCallId =
			typeof inner.toolCallId === 'string' && inner.toolCallId.length > 0
				? inner.toolCallId
				: 'tool-call';
		const name =
			typeof inner.toolName === 'string'
				? inner.toolName
				: typeof inner.name === 'string'
					? inner.name
					: 'tool';
		if (typed.type === 'tool_result') {
			const output = inner.output ?? inner.result ?? inner.partialResult;
			return {
				isError: inner.isError === true,
				kind: 'tool-result',
				output,
				toolCallId,
			};
		}
		const input = (inner.input as unknown) ?? (inner.args as unknown) ?? {};
		return { input, kind: 'tool-call', name, toolCallId };
	}

	if (wireRole === 'user' && typeof inner.prompt === 'string') {
		return { kind: 'prompt', prompt: inner.prompt };
	}

	const role: 'assistant' | 'user' = wireRole === 'user' ? 'user' : 'assistant';
	const parts: PiAgentMessagePart[] = [];
	if (Array.isArray(inner.content)) {
		for (const block of inner.content) {
			const part = contentBlockToPart(block);
			if (part) {
				parts.push(part);
			}
		}
	}
	if (typeof inner.reasoning === 'string' && inner.reasoning.length > 0) {
		parts.push({ kind: 'reasoning', text: inner.reasoning });
	} else if (typeof inner.thinking === 'string' && inner.thinking.length > 0) {
		parts.push({ kind: 'reasoning', text: inner.thinking });
	}
	if (typeof inner.text === 'string' && inner.text.length > 0) {
		parts.push({ kind: 'text', text: inner.text });
	}
	if (parts.length > 0) {
		return { kind: 'message', parts, role };
	}
	const frameType = typeof typed.type === 'string' ? typed.type : 'message';
	return { frameType, kind: 'unknown', raw: typed };
}

/**
 * Public entry point: takes any raw Pi RPC frame and returns the equivalent
 * tagged-union payload, or `null` for non-message frames (status/error/etc).
 * Re-exported so unit tests can exercise it without spinning up the adapter.
 */
export function normalizePiPayload(raw: unknown): PiAgentMessagePayload | null {
	if (!raw || typeof raw !== 'object') {
		return null;
	}
	const typed = raw as Record<string, unknown>;
	const frameType = typeof typed.type === 'string' ? typed.type : '';
	switch (frameType) {
		case 'message_end': {
			const message =
				typed.message &&
				typeof typed.message === 'object' &&
				!Array.isArray(typed.message)
					? (typed.message as Record<string, unknown>)
					: {};
			const wireRole = isMessageRole(message.role) ? message.role : 'agent';
			return normalizeMessageEnd(message, wireRole);
		}
		case 'tool_execution_start':
		case 'tool_execution_update':
		case 'tool_execution_end':
			return normalizeToolExecutionFrame(typed);
		case 'tool_call':
		case 'tool_result':
		case 'message': {
			const wireRole = isMessageRole(typed.role)
				? typed.role
				: frameType === 'tool_call' || frameType === 'tool_result'
					? 'tool'
					: 'agent';
			return normalizeLegacyMessageFrame(typed, wireRole);
		}
		default:
			return { frameType: frameType || 'unknown', kind: 'unknown', raw: typed };
	}
}
