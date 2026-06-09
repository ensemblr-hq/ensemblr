import type { DynamicToolUIPart, UIMessage } from 'ai';

import type {
	PiPersistedEnvelope,
	PiSessionEventWire,
	PiWireMessagePart,
	PiWireMessagePayload,
} from '@/shared/ipc';

type UIRole = UIMessage['role'];

type UIMessagePart = UIMessage['parts'][number];

/**
 * Converts the persisted Pi RPC event stream into the AI SDK `UIMessage` shape
 * consumed by ai-elements' `Conversation` + `Message` components.
 *
 * The wire payload is a tagged {@link PiPersistedEnvelope} union — the
 * normalization happens in the main-process adapter so this mapper just
 * pattern-matches on `payload.kind` and projects each variant to UI parts.
 *
 * Grouping rule: consecutive `message` events that share the same `turnId`
 * and the same UI role collapse into a single `UIMessage`. Errors, stderr,
 * status changes, metadata, and shutdown rows each emit their own message so
 * the timeline stays informative without losing per-event chronology.
 */
export function eventsToUIMessages(
	events: readonly PiSessionEventWire[],
): UIMessage[] {
	const result: UIMessage[] = [];
	let pending: PendingGroup | null = null;

	for (const event of events) {
		pending = handleEvent(event, pending, result);
	}

	if (pending) {
		result.push(finalizeGroup(pending));
	}

	return result;
}

interface PendingGroup {
	id: string;
	parts: UIMessagePart[];
	role: UIRole;
	signature: string;
}

function handleEvent(
	event: PiSessionEventWire,
	pending: PendingGroup | null,
	result: UIMessage[],
): PendingGroup | null {
	if (event.stream === 'stderr') {
		flush(pending, result);
		result.push(buildStderrMessage(event));
		return null;
	}

	const envelope = event.payload;
	if (!envelope) {
		flush(pending, result);
		result.push(buildSystemNoticeMessage(event, `Pi event: ${event.eventType}`));
		return null;
	}

	switch (envelope.kind) {
		case 'message':
			return handleMessageEnvelope(event, envelope, pending, result);
		case 'error':
			flush(pending, result);
			result.push(buildErrorMessage(event, envelope));
			return null;
		case 'status':
			flush(pending, result);
			result.push(
				buildSystemNoticeMessage(
					event,
					`Status: ${envelope.status}${
						envelope.previous ? ` (was ${envelope.previous})` : ''
					}`,
				),
			);
			return null;
		case 'metadata':
			flush(pending, result);
			result.push(buildSystemNoticeMessage(event, describeMetadata(envelope)));
			return null;
		case 'shutdown':
			flush(pending, result);
			result.push(
				buildSystemNoticeMessage(event, `Session ended (${envelope.reason})`),
			);
			return null;
		default: {
			// Exhaustiveness guard: a future variant should be added above.
			const exhaustive: never = envelope;
			void exhaustive;
			flush(pending, result);
			result.push(buildSystemNoticeMessage(event, `Pi event: ${event.eventType}`));
			return null;
		}
	}
}

function handleMessageEnvelope(
	event: PiSessionEventWire,
	envelope: Extract<PiPersistedEnvelope, { kind: 'message' }>,
	pending: PendingGroup | null,
	result: UIMessage[],
): PendingGroup | null {
	const uiRole: UIRole = envelope.role === 'user' ? 'user' : 'assistant';
	const signature = groupSignature(event.turnId, uiRole);

	const incomingParts = projectMessagePayload(event, envelope.payload);
	if (incomingParts.length === 0) {
		// Nothing to render (e.g., an unknown frame variant). Skip without
		// disturbing any pending group so the timeline stays clean.
		return pending;
	}

	if (!pending || pending.signature !== signature) {
		flush(pending, result);
		return {
			id: groupIdFromEvent(event, uiRole),
			parts: incomingParts,
			role: uiRole,
			signature,
		};
	}

	return { ...pending, parts: [...pending.parts, ...incomingParts] };
}

/**
 * Projects a single message payload into one or more UI parts. The variant
 * map keeps the renderer ignorant of Pi's wire shapes — the adapter has
 * already normalized them.
 */
function projectMessagePayload(
	event: PiSessionEventWire,
	payload: PiWireMessagePayload,
): UIMessagePart[] {
	switch (payload.kind) {
		case 'text':
			return payload.text
				? [{ state: 'done', text: payload.text, type: 'text' }]
				: [];
		case 'reasoning':
			return payload.text
				? [{ state: 'done', text: payload.text, type: 'reasoning' }]
				: [];
		case 'prompt':
			return payload.prompt
				? [{ state: 'done', text: payload.prompt, type: 'text' }]
				: [];
		case 'tool-call':
			return [buildToolCallPart(payload, event)];
		case 'tool-result':
			return [buildToolResultPart(payload, event)];
		case 'message':
			return payload.parts.flatMap((part) => projectMessagePart(part, event));
		case 'unknown':
			return [];
		default: {
			const exhaustive: never = payload;
			void exhaustive;
			return [];
		}
	}
}

function projectMessagePart(
	part: PiWireMessagePart,
	event: PiSessionEventWire,
): UIMessagePart[] {
	switch (part.kind) {
		case 'text':
			return part.text
				? [{ state: 'done', text: part.text, type: 'text' }]
				: [];
		case 'reasoning':
			return part.text
				? [{ state: 'done', text: part.text, type: 'reasoning' }]
				: [];
		case 'tool-call':
			return [buildToolCallPart(part, event)];
		case 'tool-result':
			return [buildToolResultPart(part, event)];
		default: {
			const exhaustive: never = part;
			void exhaustive;
			return [];
		}
	}
}

function buildToolCallPart(
	source: Extract<PiWireMessagePart | PiWireMessagePayload, { kind: 'tool-call' }>,
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

function buildToolResultPart(
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

function flush(pending: PendingGroup | null, result: UIMessage[]): void {
	if (!pending) {
		return;
	}
	result.push(finalizeGroup(pending));
}

function finalizeGroup(group: PendingGroup): UIMessage {
	const parts =
		group.parts.length > 0
			? group.parts
			: ([{ state: 'done', text: '', type: 'text' }] satisfies UIMessagePart[]);
	return {
		id: group.id,
		parts,
		role: group.role,
	};
}

function buildStderrMessage(event: PiSessionEventWire): UIMessage {
	const detail = readStderrDetail(event.payload);
	return {
		id: `pi-event:${event.id}`,
		parts: [{ state: 'done', text: `[stderr] ${detail}`, type: 'text' }],
		role: 'system',
	};
}

function buildErrorMessage(
	event: PiSessionEventWire,
	envelope: Extract<PiPersistedEnvelope, { kind: 'error' }>,
): UIMessage {
	const error = envelope.error;
	const tag = error.recoverable === false ? 'fatal' : 'recoverable';
	const head = error.message || 'Runtime error';
	const body = error.detail ? `\n${error.detail}` : '';
	return {
		id: `pi-event:${event.id}`,
		parts: [{ state: 'done', text: `[${tag}] ${head}${body}`, type: 'text' }],
		role: 'system',
	};
}

function buildSystemNoticeMessage(
	event: PiSessionEventWire,
	text: string,
): UIMessage {
	return {
		id: `pi-event:${event.id}`,
		parts: [{ state: 'done', text, type: 'text' }],
		role: 'system',
	};
}

function describeMetadata(
	envelope: Extract<PiPersistedEnvelope, { kind: 'metadata' }>,
): string {
	if (envelope.metadata.sessionId) {
		return `Pi runtime session id: ${envelope.metadata.sessionId}`;
	}
	if (envelope.metadata.chatTitle) {
		return `Chat renamed: ${envelope.metadata.chatTitle}`;
	}
	return 'Pi runtime metadata received.';
}

function readStderrDetail(payload: PiPersistedEnvelope | null): string {
	if (payload?.kind === 'error') {
		return payload.error.detail ?? payload.error.message ?? '(empty stderr chunk)';
	}
	return '(empty stderr chunk)';
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

function groupSignature(turnId: string | null, role: UIRole): string {
	const turnKey = turnId ?? 'no-turn';
	return `${turnKey}::${role}`;
}

function groupIdFromEvent(event: PiSessionEventWire, role: UIRole): string {
	// Use the trigger event id so multiple same-role groups within a turn
	// (e.g. two user prompts before the next assistant reply) stay unique.
	const turnKey = event.turnId ?? 'no-turn';
	return `pi-turn:${turnKey}:${role}:${event.id}`;
}
