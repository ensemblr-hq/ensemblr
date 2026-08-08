import type {
	AgentMessagePart,
	AgentMessagePayload,
} from '../agent-runtime/agent-types.ts';

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
 *
 * Extension-injected messages arrive under Pi's `custom` role, which
 * {@link isMessageRole} does not recognize — left to the default path they
 * would read as prose the assistant wrote, so they branch off first.
 */
export function normalizeMessageEnd(
	message: Record<string, unknown>,
	wireRole: 'agent' | 'tool' | 'user',
): AgentMessagePayload {
	if (message.role === 'custom') {
		return normalizeCustomMessage(message);
	}
	const role: 'assistant' | 'user' = wireRole === 'user' ? 'user' : 'assistant';
	const parts = normalizeContentParts(message.content);
	return { kind: 'message', parts, role };
}

/**
 * Normalizes Pi's `role: "custom"` message — what an extension injects through
 * `sendMessage` or a `before_agent_start` hook — into the `custom` payload.
 * @param message - The `custom` message object off a `message_end` frame
 * @returns The custom payload carrying the injector's tag, hint, and text
 */
function normalizeCustomMessage(
	message: Record<string, unknown>,
): AgentMessagePayload {
	const customType =
		typeof message.customType === 'string' && message.customType.length > 0
			? message.customType
			: 'custom';
	return {
		customType,
		display: message.display === true,
		kind: 'custom',
		text: normalizeContentParts(message.content)
			.flatMap((part) => (part.kind === 'text' ? [part.text] : []))
			.join('\n'),
	};
}

/**
 * Projects Pi's `content: [{type:'text'|'thinking'|'toolCall', ...}]` array
 * into structured {@link AgentMessagePart} entries. Blocks we don't know how
 * to interpret are skipped.
 */
export function normalizeContentParts(
	content: unknown,
): readonly AgentMessagePart[] {
	if (typeof content === 'string') {
		return content.length > 0 ? [{ kind: 'text', text: content }] : [];
	}
	if (!Array.isArray(content)) {
		return [];
	}
	const parts: AgentMessagePart[] = [];
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
export function contentBlockToPart(block: unknown): AgentMessagePart | null {
	if (!block || typeof block !== 'object') {
		return null;
	}
	const record = block as Record<string, unknown>;
	const blockType = typeof record.type === 'string' ? record.type : '';
	if (blockType === 'text' && typeof record.text === 'string') {
		return { kind: 'text', text: record.text };
	}
	// An empty block is dropped rather than kept: the timeline renders every
	// reasoning part it receives, and only Claude — which redacts its prose and
	// ships the signature alone — has a turn worth marking with no text.
	const thinking = readNonEmptyString(record.thinking);
	if (blockType === 'thinking' && thinking) {
		return { kind: 'reasoning', text: thinking };
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
): AgentMessagePayload {
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
): AgentMessagePayload {
	const inner = readInnerPayload(typed);

	if (wireRole === 'tool') {
		return normalizeLegacyToolFrame(typed, inner);
	}

	if (wireRole === 'user' && typeof inner.prompt === 'string') {
		return { kind: 'prompt', prompt: inner.prompt };
	}

	const parts = readLegacyParts(inner);
	if (parts.length > 0) {
		return {
			kind: 'message',
			parts,
			role: wireRole === 'user' ? 'user' : 'assistant',
		};
	}
	const frameType = typeof typed.type === 'string' ? typed.type : 'message';
	return { frameType, kind: 'unknown', raw: typed };
}

/**
 * Unwraps the nested `payload` object a legacy frame may wrap its fields in.
 * @param typed - The raw legacy frame
 * @returns The nested payload when present, otherwise the frame itself
 */
function readInnerPayload(
	typed: Record<string, unknown>,
): Record<string, unknown> {
	return typed.payload &&
		typeof typed.payload === 'object' &&
		!Array.isArray(typed.payload)
		? (typed.payload as Record<string, unknown>)
		: typed;
}

/**
 * Normalizes a legacy `tool_call` / `tool_result` frame into its tool payload.
 * @param typed - The raw legacy frame, read for its `type` discriminator
 * @param inner - The frame's unwrapped field bag
 * @returns The tool-call or tool-result payload
 */
function normalizeLegacyToolFrame(
	typed: Record<string, unknown>,
	inner: Record<string, unknown>,
): AgentMessagePayload {
	const toolCallId = readNonEmptyString(inner.toolCallId) ?? 'tool-call';
	if (typed.type === 'tool_result') {
		return {
			isError: inner.isError === true,
			kind: 'tool-result',
			output: inner.output ?? inner.result ?? inner.partialResult,
			toolCallId,
		};
	}
	return {
		input: (inner.input as unknown) ?? (inner.args as unknown) ?? {},
		kind: 'tool-call',
		name: readLegacyToolName(inner),
		toolCallId,
	};
}

/**
 * Reads the tool name a legacy frame publishes under either `toolName` or `name`.
 * @param inner - The frame's unwrapped field bag
 * @returns The tool name, defaulting to `tool`
 */
function readLegacyToolName(inner: Record<string, unknown>): string {
	if (typeof inner.toolName === 'string') {
		return inner.toolName;
	}
	return typeof inner.name === 'string' ? inner.name : 'tool';
}

/**
 * Collects the content, reasoning, and text parts a legacy message frame carries.
 * @param inner - The frame's unwrapped field bag
 * @returns The parts in render order, empty when the frame carries none
 */
function readLegacyParts(
	inner: Record<string, unknown>,
): readonly AgentMessagePart[] {
	const parts: AgentMessagePart[] = Array.isArray(inner.content)
		? [...normalizeContentParts(inner.content)]
		: [];
	const reasoning =
		readNonEmptyString(inner.reasoning) ?? readNonEmptyString(inner.thinking);
	if (reasoning) {
		parts.push({ kind: 'reasoning', text: reasoning });
	}
	const text = readNonEmptyString(inner.text);
	if (text) {
		parts.push({ kind: 'text', text });
	}
	return parts;
}

/**
 * Reads a wire field as a non-empty string.
 * @param value - Raw field value
 * @returns The string, or null when it is absent or empty
 */
function readNonEmptyString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Public entry point: takes any raw Pi RPC frame and returns the equivalent
 * tagged-union payload, or `null` for non-message frames (status/error/etc).
 * Re-exported so unit tests can exercise it without spinning up the adapter.
 */
export function normalizePiPayload(raw: unknown): AgentMessagePayload | null {
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
