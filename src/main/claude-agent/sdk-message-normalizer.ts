import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import type {
	AgentContextUsage,
	AgentEvent,
	AgentMessagePart,
	AgentMessagePayload,
	AgentModelMetadata,
	AgentSessionStatus,
} from '../agent-runtime/agent-types.ts';

/** What the runtime told us about itself once its session was up. */
export interface SdkSessionDiscovery {
	model: AgentModelMetadata | null;
	sessionId: string;
}

/** Options for {@link createSdkMessageNormalizer}. */
export interface CreateSdkMessageNormalizerOptions {
	now?: () => Date;
	/**
	 * Called when the runtime reports its resolved session id and model. The
	 * adapter owns `AgentSessionMetadata`, so it patches and emits the
	 * `metadata` event rather than the normalizer synthesising a partial one.
	 */
	onDiscovery?: (discovery: SdkSessionDiscovery) => void;
}

/**
 * Stateful translator from Claude Agent SDK messages to the provider-neutral
 * `AgentEvent` stream. One instance per session: it remembers the reported
 * status, the active turn, and the last known context window so it can emit the
 * transitions and usage snapshots the timeline expects.
 */
export interface SdkMessageNormalizer {
	/** Status events that settle an open turn the runtime never closed with a `result`. */
	settleTurn: () => readonly AgentEvent[];
	/** Translates one SDK message into zero or more normalized events. */
	normalize: (message: SDKMessage) => readonly AgentEvent[];
	/** Stamps subsequent message events with this turn id. */
	setTurnId: (turnId: string | null) => void;
}

/**
 * Builds a per-session {@link SdkMessageNormalizer}.
 *
 * The taxonomy target is `docs/pi/event-taxonomy.md`: Claude's `stream_event`
 * deltas become `text-delta`/`reasoning-delta` (broadcast, never persisted), its
 * `assistant` message becomes the authoritative `message` seal, and its `result`
 * closes the turn. SDK message types Ensemblr does not model — hook chatter,
 * task notifications, rate-limit pings — are dropped rather than forwarded as
 * `unknown`: Pi emits a handful of frame types, the SDK emits dozens, and each
 * would otherwise surface as a system notice on the timeline.
 * @param options - Clock override and the discovery callback.
 * @returns A normalizer bound to one session's streaming state.
 */
export function createSdkMessageNormalizer({
	now = () => new Date(),
	onDiscovery,
}: CreateSdkMessageNormalizerOptions = {}): SdkMessageNormalizer {
	let status: AgentSessionStatus = 'starting';
	let turnId: string | null = null;
	let contextWindow = 0;

	const at = (): string => now().toISOString();

	const transitionTo = (next: AgentSessionStatus): readonly AgentEvent[] => {
		if (status === next) {
			return [];
		}
		const previous = status;
		status = next;
		return [{ at: at(), previous, status: next, type: 'status' }];
	};

	const messageEvent = (
		payload: AgentMessagePayload,
		role: 'agent' | 'tool' | 'user',
	): AgentEvent => ({ at: at(), payload, role, turnId, type: 'message' });

	const usageEvent = (usage: AgentContextUsage): AgentEvent => ({
		at: at(),
		type: 'context-usage',
		usage,
	});

	const handleSystem = (
		message: Extract<SDKMessage, { type: 'system' }>,
	): readonly AgentEvent[] => {
		if (message.subtype === 'init') {
			onDiscovery?.({
				model: readModelMetadata(message.model),
				sessionId: message.session_id,
			});
			return transitionTo('idle');
		}

		if (message.subtype === 'compact_boundary') {
			const tokens = message.compact_metadata?.post_tokens;
			return typeof tokens === 'number'
				? [usageEvent(toUsage({ contextWindow, tokens }))]
				: [];
		}

		return [];
	};

	const handleResult = (
		message: Extract<SDKMessage, { type: 'result' }>,
	): readonly AgentEvent[] => {
		const events: AgentEvent[] = [];

		const totals = readUsageTotals(message.modelUsage);
		if (totals) {
			contextWindow = totals.contextWindow || contextWindow;
			events.push(
				usageEvent(toUsage({ contextWindow, tokens: totals.tokens })),
			);
		}

		if (message.subtype !== 'success') {
			events.push({
				at: at(),
				error: {
					code: 'adapter-failure',
					detail: message.errors?.join('\n'),
					message: `Claude ended the turn: ${message.subtype}.`,
					recoverable: true,
				},
				type: 'error',
			});
		}

		events.push(...transitionTo('idle'));
		return events;
	};

	return {
		normalize: (message) => {
			switch (message.type) {
				case 'system':
					return handleSystem(message);
				case 'stream_event':
					return normalizeStreamEvent(message, messageEvent);
				case 'assistant':
					return [
						...transitionTo('streaming'),
						...normalizeAssistant(message, messageEvent),
					];
				case 'user':
					return normalizeUser(message, messageEvent);
				case 'result':
					return handleResult(message);
				default:
					return [];
			}
		},
		setTurnId: (next) => {
			turnId = next;
		},
		settleTurn: () => transitionTo('idle'),
	};
}

/** Emits a normalized message event for one payload and role. */
type MessageEventFactory = (
	payload: AgentMessagePayload,
	role: 'agent' | 'tool' | 'user',
) => AgentEvent;

/**
 * Maps a partial-message `stream_event` onto the timeline's streaming payloads.
 * Routing reads `delta.type` directly, so no per-index block registry is needed.
 * Tool-argument deltas (`input_json_delta`) are dropped: the wire union carries
 * no partial-tool-input variant, and the sealing `assistant` message delivers
 * the complete input a moment later.
 * @param message - The `stream_event` SDK message.
 * @param messageEvent - Factory that stamps the current turn onto an event.
 * @returns Normalized events, empty for stream events with no timeline effect.
 */
function normalizeStreamEvent(
	message: Extract<SDKMessage, { type: 'stream_event' }>,
	messageEvent: MessageEventFactory,
): readonly AgentEvent[] {
	const event = message.event as unknown as Record<string, unknown>;
	if (readString(event.type) !== 'content_block_delta') {
		return [];
	}

	const delta = isRecord(event.delta) ? event.delta : {};

	if (readString(delta.type) === 'text_delta') {
		const text = readString(delta.text);
		return text ? [messageEvent({ kind: 'text-delta', text }, 'agent')] : [];
	}

	if (readString(delta.type) === 'thinking_delta') {
		const text = readString(delta.thinking);
		return text
			? [messageEvent({ kind: 'reasoning-delta', text }, 'agent')]
			: [];
	}

	return [];
}

/**
 * Maps the authoritative `assistant` message. It emits both the composite
 * `message` seal — which replaces the streamed deltas — and one `tool-call` per
 * `tool_use` block, mirroring how Pi pairs `message_end` with
 * `tool_execution_start` so a tool card opens as soon as the call is known.
 * @param message - The `assistant` SDK message.
 * @param messageEvent - Factory that stamps the current turn onto an event.
 * @returns The seal followed by its tool-call events.
 */
function normalizeAssistant(
	message: Extract<SDKMessage, { type: 'assistant' }>,
	messageEvent: MessageEventFactory,
): readonly AgentEvent[] {
	const parts = readBlocks(message.message?.content).flatMap(toMessagePart);

	return [
		messageEvent({ kind: 'message', parts, role: 'assistant' }, 'agent'),
		...parts
			.filter((part) => part.kind === 'tool-call')
			.map((call) =>
				messageEvent(
					{
						input: call.input,
						kind: 'tool-call',
						name: call.name,
						toolCallId: call.toolCallId,
					},
					'tool',
				),
			),
	];
}

/**
 * Maps a `user` message. The SDK reuses this type for two unrelated things: the
 * echo of a prompt the user typed, and the tool output Claude Code feeds back
 * after running a tool. Only the tool output is projected.
 *
 * The echo is dropped because the adapter already emits the prompt the moment
 * it is submitted — immediately, and whether or not the turn later fails.
 * Projecting the echo too would render every prompt as two bubbles, since the
 * timeline keys user groups by event id and never merges them. Resuming a
 * session replays earlier user turns down this same path, which would duplicate
 * history Ensemblr already persists itself.
 * @param message - The `user` SDK message.
 * @param messageEvent - Factory that stamps the current turn onto an event.
 * @returns Tool-result events, or nothing for a prompt echo.
 */
function normalizeUser(
	message: Extract<SDKMessage, { type: 'user' }>,
	messageEvent: MessageEventFactory,
): readonly AgentEvent[] {
	const blocks = readBlocks(message.message?.content);
	const toolResults = blocks.filter(
		(block) => readString(block.type) === 'tool_result',
	);

	return toolResults.map((block) =>
		messageEvent(
			{
				isError: block.is_error === true,
				kind: 'tool-result',
				output: block.content,
				toolCallId: readString(block.tool_use_id) ?? 'tool-call',
			},
			'tool',
		),
	);
}

/**
 * Sums the token counters the SDK reports per model. Multi-model turns (a
 * fallback kicked in, a subagent ran a cheaper model) fold onto the widest
 * window, which is the one the user's own conversation is bounded by.
 * @param modelUsage - The `modelUsage` map off a `result` message.
 * @returns Summed tokens and the widest window, or null when nothing was reported.
 */
function readUsageTotals(
	modelUsage: Extract<SDKMessage, { type: 'result' }>['modelUsage'],
): { contextWindow: number; tokens: number } | null {
	const entries = Object.values(modelUsage ?? {});
	if (entries.length === 0) {
		return null;
	}

	let tokens = 0;
	let contextWindow = 0;
	for (const entry of entries) {
		tokens +=
			(entry.inputTokens ?? 0) +
			(entry.outputTokens ?? 0) +
			(entry.cacheReadInputTokens ?? 0) +
			(entry.cacheCreationInputTokens ?? 0);
		contextWindow = Math.max(contextWindow, entry.contextWindow ?? 0);
	}

	return { contextWindow, tokens };
}

/**
 * Builds the usage snapshot, leaving `percent` null when no window is known yet
 * so the renderer shows "unknown" rather than a bar pinned at zero.
 * @param input - Token count and the context window it is measured against.
 * @returns The context-usage snapshot.
 */
function toUsage({
	contextWindow,
	tokens,
}: {
	contextWindow: number;
	tokens: number;
}): AgentContextUsage {
	return {
		contextWindow,
		percent: contextWindow > 0 ? (tokens / contextWindow) * 100 : null,
		tokens,
	};
}

/**
 * Projects one Anthropic content block onto a timeline part. Blocks Ensemblr
 * does not render — `tool_result` (handled by its own branch), server-tool
 * blocks — yield nothing.
 * @param block - One entry from a message's `content` array.
 * @returns A single-element array with the part, or an empty array.
 */
function toMessagePart(
	block: Record<string, unknown>,
): readonly AgentMessagePart[] {
	const blockType = readString(block.type);

	if (blockType === 'text') {
		const text = readString(block.text);
		return text ? [{ kind: 'text', text }] : [];
	}

	if (blockType === 'thinking') {
		const text = readString(block.thinking);
		return text ? [{ kind: 'reasoning', text }] : [];
	}

	if (blockType === 'tool_use') {
		const name = readString(block.name) ?? 'tool';
		return [
			{
				input: isRecord(block.input) ? block.input : {},
				kind: 'tool-call',
				name,
				toolCallId: readString(block.id) ?? name,
			},
		];
	}

	return [];
}

/**
 * Maps the SDK's model id onto the timeline's model attribution. Claude Code
 * model ids carry no provider segment, so the inference provider is named
 * explicitly rather than parsed out of the id.
 * @param model - Model id reported by the `init` message.
 * @returns Model metadata, or null when the runtime reported no model.
 */
function readModelMetadata(
	model: string | undefined,
): AgentModelMetadata | null {
	return model ? { id: model, provider: 'anthropic' } : null;
}

/**
 * Reads a message's `content` as an array of block records. String content —
 * the shorthand the SDK accepts for plain user text — is lifted into one text
 * block so both shapes normalize identically.
 * @param content - Raw `content` field off an SDK message.
 * @returns The blocks, empty when the content is neither a string nor an array.
 */
function readBlocks(content: unknown): readonly Record<string, unknown>[] {
	if (typeof content === 'string') {
		return content ? [{ text: content, type: 'text' }] : [];
	}
	return Array.isArray(content) ? content.filter(isRecord) : [];
}

/**
 * Narrows an unknown value to a plain object.
 * @param value - Candidate value.
 * @returns True when `value` is a non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a field as a non-empty string.
 * @param value - Raw field value.
 * @returns The string, or null when absent or empty.
 */
function readString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}
