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
	let contextTokens = 0;
	let mainModel: string | null = null;
	let reported: AgentContextUsage | null = null;

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

	/**
	 * Emits a usage snapshot when the reading has actually moved. Stays silent
	 * until the window is known, because a zero window renders as a gauge with no
	 * denominator rather than as an unknown one, and the runtime only names the
	 * window on its first `result`.
	 * @returns One `context-usage` event, or nothing when there is no news.
	 */
	const reportUsage = (): readonly AgentEvent[] => {
		if (contextTokens === 0 || contextWindow === 0) {
			return [];
		}
		if (
			reported?.contextWindow === contextWindow &&
			reported.tokens === contextTokens
		) {
			return [];
		}
		reported = toUsage({ contextWindow, tokens: contextTokens });
		return [{ at: at(), type: 'context-usage', usage: reported }];
	};

	const handleSystem = (
		message: Extract<SDKMessage, { type: 'system' }>,
	): readonly AgentEvent[] => {
		if (message.subtype === 'init') {
			mainModel = readString(message.model);
			onDiscovery?.({
				model: readModelMetadata(message.model),
				sessionId: message.session_id,
			});
			return transitionTo('idle');
		}

		if (message.subtype === 'compact_boundary') {
			const tokens = message.compact_metadata?.post_tokens;
			if (typeof tokens !== 'number') {
				return [];
			}
			contextTokens = tokens;
			return reportUsage();
		}

		return [];
	};

	/**
	 * Seals one assistant turn and, for main-thread responses only, re-reads the
	 * live occupancy from it. Subagent responses (`parent_tool_use_id` set) are
	 * measured against their own window, so they never restate the user's.
	 * @param message - The `assistant` SDK message.
	 * @returns The seal and its tool calls, plus a usage snapshot when one is due.
	 */
	const handleAssistant = (
		message: Extract<SDKMessage, { type: 'assistant' }>,
	): readonly AgentEvent[] => {
		const events = [
			...transitionTo('streaming'),
			...normalizeAssistant(message, messageEvent),
		];

		if (message.parent_tool_use_id !== null) {
			return events;
		}

		mainModel = readString(message.message?.model) ?? mainModel;

		const occupied = readContextTokens(message);
		if (occupied === null) {
			return events;
		}

		contextTokens = occupied;
		return [...events, ...reportUsage()];
	};

	const handleResult = (
		message: Extract<SDKMessage, { type: 'result' }>,
	): readonly AgentEvent[] => {
		const events: AgentEvent[] = [];

		contextWindow =
			readContextWindow(message.modelUsage, mainModel) || contextWindow;
		events.push(...reportUsage());

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
					return handleAssistant(message);
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
		...parts.flatMap((part) =>
			part.kind === 'tool-call'
				? [
						messageEvent(
							{
								input: part.input,
								kind: 'tool-call',
								name: part.name,
								toolCallId: part.toolCallId,
							},
							'tool',
						),
					]
				: [],
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
 * Reads the window the user's own conversation is bounded by, which is the main
 * model's — `modelUsage` covers subagents, sidechains and compaction calls too,
 * and is cumulative, so one wide-window subagent would otherwise pin the
 * denominator for the rest of the session and halve the reported percentage.
 * The widest entry is only a fallback for when the main model cannot be matched.
 * @param modelUsage - The `modelUsage` map off a `result` message.
 * @param mainModel - Model id the main thread last answered on.
 * @returns The main model's window, the widest reported one, or 0 for neither.
 */
function readContextWindow(
	modelUsage: Extract<SDKMessage, { type: 'result' }>['modelUsage'],
	mainModel: string | null,
): number {
	const entries = Object.entries(modelUsage ?? {});
	const main = entries.find(
		([id, entry]) => id === mainModel || entry.canonicalModel === mainModel,
	)?.[1];
	if (main && (main.contextWindow ?? 0) > 0) {
		return main.contextWindow;
	}

	let widest = 0;
	for (const [, entry] of entries) {
		widest = Math.max(widest, entry.contextWindow ?? 0);
	}
	return widest;
}

/**
 * Reads how much of the window a response left occupied: its whole prompt —
 * fresh, cache-written, and cache-read input, which is how the Messages API
 * defines total input tokens — plus the text it just appended to the thread.
 *
 * Deliberately not `result.modelUsage`, whose counters are cumulative session
 * totals kept for billing. Every turn re-reads the prompt cache, so summing
 * `cacheReadInputTokens` across a session reports several times the window's
 * worth of tokens within a handful of turns. One response's own usage is the
 * only figure that describes the live conversation.
 * @param message - The `assistant` SDK message.
 * @returns Occupied tokens, or null when the response reported no usage.
 */
function readContextTokens(
	message: Extract<SDKMessage, { type: 'assistant' }>,
): number | null {
	const usage = isRecord(message.message?.usage) ? message.message.usage : null;
	if (!usage) {
		return null;
	}

	const occupied =
		readTokenCount(usage.input_tokens) +
		readTokenCount(usage.cache_creation_input_tokens) +
		readTokenCount(usage.cache_read_input_tokens) +
		readTokenCount(usage.output_tokens);

	return occupied > 0 ? occupied : null;
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
 * Reads a field as a usable token counter, treating absent and negative values
 * as zero so a partial usage block still sums.
 * @param value - Raw field value.
 * @returns The count, or 0 when the field carries no usable number.
 */
function readTokenCount(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0
		? value
		: 0;
}

/**
 * Reads a field as a non-empty string.
 * @param value - Raw field value.
 * @returns The string, or null when absent or empty.
 */
function readString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}
