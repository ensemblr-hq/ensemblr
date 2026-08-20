import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import type {
	AgentContextUsage,
	AgentEvent,
	AgentMessagePart,
	AgentMessagePayload,
	AgentModelMetadata,
	AgentSessionStatus,
} from '../agent-runtime/agent-types.ts';
import { toPlanLimit, toSessionCost } from './claude-usage.ts';
import { readLimitNotice } from './limit-notice.ts';
import { isRecord, readBlocks } from './sdk-content-blocks.ts';
import {
	createStreamedReasoningByThread,
	type StreamedReasoningByThread,
} from './streamed-reasoning.ts';
import { toolResultDetails } from './tool-result-details.ts';

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
	/**
	 * Seeds the session's opening usage from a reading the adapter asked the
	 * runtime for directly, rather than one read off the message stream. The
	 * window it carries measures every response until a `result` names one of its
	 * own.
	 *
	 * Seeds only what is still unknown, and nothing at all once a snapshot has
	 * been emitted: this reading was taken at session start, so a stream that has
	 * already moved either half has a fresher figure than it does.
	 */
	observeContextUsage: (usage: {
		contextWindow: number;
		tokens: number;
	}) => readonly AgentEvent[];
	/**
	 * Opens a turn the instant its prompt is queued, rather than waiting for the
	 * runtime's first message. Claude takes seconds to reach that message, and
	 * the timeline's working indicator and turn timer both key off the `status`
	 * event, so without this the chat looks idle for the whole gap.
	 */
	beginTurn: () => readonly AgentEvent[];
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
	let exhaustedResetsAt: string | null = null;
	const reasoningByThread = createStreamedReasoningByThread();

	const at = (): string => now().toISOString();

	/**
	 * The banked reset, dropped once it has passed. A stamp the plan has already
	 * moved past renders as "resets now" on a row the account is still locked out
	 * of, which reads as an invitation to press Continue straight into the same
	 * refusal — worse than saying nothing about the wait at all.
	 * @returns The reset instant, or null when none is banked or it has elapsed.
	 */
	const unspentReset = (): string | null => {
		if (!exhaustedResetsAt) {
			return null;
		}
		return Date.parse(exhaustedResetsAt) > now().getTime()
			? exhaustedResetsAt
			: null;
	};

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
		parentToolCallId?: string | null,
	): AgentEvent => ({
		at: at(),
		...(parentToolCallId ? { parentToolCallId } : {}),
		payload,
		role,
		turnId,
		type: 'message',
	});

	/**
	 * Emits a usage snapshot when the reading has actually moved. Stays silent
	 * until something has been measured against a known window: a zero window
	 * renders as a gauge with no denominator rather than as an unknown one, and a
	 * zero occupancy would overwrite a resumed thread's real reading with the
	 * nothing this session has seen so far.
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
			// `init` can land after the opening prompt was already queued, and only
			// a session still waiting for its first prompt should be called idle.
			return status === 'starting' ? transitionTo('idle') : [];
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
	 * measured against their own near-empty window, so letting them through would
	 * sawtooth the gauge; their events still flow, tagged with the parent call.
	 *
	 * A main-thread message that is really a plan-limit banner never seals a turn
	 * at all: it is the runtime speaking about the account rather than the model
	 * answering, so it leaves as an `error` and the turn keeps no answer. The
	 * renderer drops the deltas that streamed the same sentence, which is why the
	 * error carries the banner verbatim rather than a rephrasing.
	 * @param message - The `assistant` SDK message.
	 * @returns The seal and its tool calls, plus a usage snapshot when one is due — or the lone failure a banner becomes.
	 */
	const handleAssistant = (
		message: Extract<SDKMessage, { type: 'assistant' }>,
	): readonly AgentEvent[] => {
		const notice =
			readString(message.parent_tool_use_id) === null
				? readLimitNotice(message)
				: null;
		if (notice) {
			// Fatal, not recoverable: the turn ended without an answer, and the
			// timeline surfaces fatal errors only. Tagged recoverable the banner
			// would vanish rather than become the row that offers Continue.
			return [
				{
					at: at(),
					error: {
						code: 'adapter-failure',
						message: notice,
						recoverable: false,
						resetsAt: unspentReset(),
					},
					type: 'error',
				},
			];
		}

		const events = [
			...transitionTo('streaming'),
			...normalizeAssistant(message, messageEvent, reasoningByThread),
		];

		if (readString(message.parent_tool_use_id) !== null) {
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
		// A crashed or startup-failed turn can report its totals zeroed, and the
		// figure is the session's running total rather than this turn's share — so
		// reporting one would walk the gauge backwards to nothing.
		if (Number.isFinite(message.total_cost_usd) && message.total_cost_usd > 0) {
			events.push({
				at: at(),
				cost: toSessionCost(message.total_cost_usd, message.modelUsage),
				type: 'session-cost',
			});
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

	/**
	 * Turns a pushed rate-limit frame into a plan-limit event. The runtime emits
	 * one whenever a window moves, so the composer gauge tracks the plan without
	 * the app ever asking.
	 *
	 * A frame that reports the plan as spent also banks its reset instant, which
	 * is the only structured reading of "when does this clear" the session gets:
	 * the banner the runtime prints a moment later names the time in English prose
	 * the renderer cannot translate.
	 *
	 * A frame reporting the plan spendable again clears that stamp. Keeping it
	 * would let a second, unrelated banner later in the same session inherit the
	 * first window's reset, which by then has passed.
	 */
	const handleRateLimit = (
		message: Extract<SDKMessage, { type: 'rate_limit_event' }>,
	): readonly AgentEvent[] => {
		const limit = toPlanLimit(message.rate_limit_info);
		if (!limit) {
			return [];
		}
		exhaustedResetsAt =
			limit.status === 'rejected'
				? (limit.window.resetsAt ?? exhaustedResetsAt)
				: null;
		return [{ at: at(), limit, type: 'plan-limit' }];
	};

	return {
		beginTurn: () => transitionTo('streaming'),
		observeContextUsage: (usage) => {
			if (reported) {
				return [];
			}
			contextWindow = contextWindow || usage.contextWindow;
			contextTokens = contextTokens || usage.tokens;
			return reportUsage();
		},
		normalize: (message) => {
			switch (message.type) {
				case 'system':
					return handleSystem(message);
				case 'stream_event':
					return normalizeStreamEvent(message, messageEvent, reasoningByThread);
				case 'assistant':
					return handleAssistant(message);
				case 'user':
					return normalizeUser(message, messageEvent);
				case 'result':
					return handleResult(message);
				case 'rate_limit_event':
					return handleRateLimit(message);
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

/**
 * Emits a normalized message event for one payload and role, tagged with the
 * tool call whose subagent produced it when it did not come from the main thread.
 */
type MessageEventFactory = (
	payload: AgentMessagePayload,
	role: 'agent' | 'tool' | 'user',
	parentToolCallId?: string | null,
) => AgentEvent;

/**
 * Maps a partial-message `stream_event` onto the timeline's streaming payloads.
 * Routing reads `delta.type` directly, so no per-index block registry is needed.
 * Tool-argument deltas (`input_json_delta`) are dropped: the wire union carries
 * no partial-tool-input variant, and the sealing `assistant` message delivers
 * the complete input a moment later.
 * Reasoning deltas are also banked into `reasoning`: the sealing `assistant`
 * message carries its `thinking` blocks emptied, so this stream is the only
 * place the text ever appears and the seal has to be refilled from it.
 * @param message - The `stream_event` SDK message.
 * @param messageEvent - Factory that stamps the current turn onto an event.
 * @param reasoningByThread - Per-thread buffers collecting reasoning text.
 * @returns Normalized events, empty for stream events with no timeline effect.
 */
function normalizeStreamEvent(
	message: Extract<SDKMessage, { type: 'stream_event' }>,
	messageEvent: MessageEventFactory,
	reasoningByThread: StreamedReasoningByThread,
): readonly AgentEvent[] {
	const event = message.event as unknown as Record<string, unknown>;
	const eventType = readString(event.type);
	const parentToolCallId = readString(message.parent_tool_use_id);
	const reasoning = reasoningByThread.forThread(parentToolCallId);

	if (eventType === 'message_start') {
		reasoning.reset();
		return [];
	}

	if (eventType !== 'content_block_delta') {
		return [];
	}

	const delta = isRecord(event.delta) ? event.delta : {};

	if (readString(delta.type) === 'text_delta') {
		const text = readString(delta.text);
		return text
			? [messageEvent({ kind: 'text-delta', text }, 'agent', parentToolCallId)]
			: [];
	}

	if (readString(delta.type) === 'thinking_delta') {
		const text = readString(delta.thinking);
		if (!text) {
			return [];
		}
		const blockIndex = readBlockIndex(event.index);
		if (blockIndex !== null) {
			reasoning.append(blockIndex, text);
		}
		return [
			messageEvent(
				{ kind: 'reasoning-delta', text },
				'agent',
				parentToolCallId,
			),
		];
	}

	return [];
}

/**
 * Reads a stream event's content-block index, which pairs a delta with the
 * block the sealing message will carry at that position. An unreadable index is
 * refused rather than defaulted: banking the text under a block it did not come
 * from would attribute one block's reasoning to another, which nothing
 * downstream could detect.
 * @param value - Raw `index` field off the stream event.
 * @returns The index, or null when the event reported none Ensemblr can use.
 */
function readBlockIndex(value: unknown): number | null {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0
		? value
		: null;
}

/**
 * Maps the authoritative `assistant` message. It emits both the composite
 * `message` seal — which replaces the streamed deltas — and one `tool-call` per
 * `tool_use` block, mirroring how Pi pairs `message_end` with
 * `tool_execution_start` so a tool card opens as soon as the call is known.
 * @param message - The `assistant` SDK message.
 * @param messageEvent - Factory that stamps the current turn onto an event.
 * @param reasoningByThread - Per-thread buffers holding text banked from `thinking_delta` events.
 * @returns The seal followed by its tool-call events.
 */
function normalizeAssistant(
	message: Extract<SDKMessage, { type: 'assistant' }>,
	messageEvent: MessageEventFactory,
	reasoningByThread: StreamedReasoningByThread,
): readonly AgentEvent[] {
	const parentToolCallId = readString(message.parent_tool_use_id);
	const reasoning = reasoningByThread.forThread(parentToolCallId);

	const parts = readBlocks(message.message?.content).flatMap((block, index) =>
		toMessagePart(block, reasoning.take(index)),
	);
	reasoning.reset();

	return [
		messageEvent(
			{ kind: 'message', parts, role: 'assistant' },
			'agent',
			parentToolCallId,
		),
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
							parentToolCallId,
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
 *
 * The result travels in the `{ content, details }` envelope the timeline reads,
 * with `details` carrying whatever `tool_use_result` describes structurally —
 * an edit's patch, for one — that the text sent to the model leaves out. It is
 * attached only to a lone result, since one message reports one tool's
 * structured output however many results it batches.
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
	const details =
		toolResults.length === 1
			? toolResultDetails(message.tool_use_result)
			: null;

	const parentToolCallId = readString(message.parent_tool_use_id);

	return toolResults.map((block) =>
		messageEvent(
			{
				isError: block.is_error === true,
				kind: 'tool-result',
				output: { content: readBlocks(block.content), details },
				toolCallId: readString(block.tool_use_id) ?? 'tool-call',
			},
			'tool',
			parentToolCallId,
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
 * A `thinking` block arrives with its text stripped — the seal keeps only the
 * signature — so its reasoning is recovered from the deltas that preceded it.
 * @param block - One entry from a message's `content` array.
 * @param streamedReasoning - Reasoning banked for this block's index, if any.
 * @returns A single-element array with the part, or an empty array.
 */
function toMessagePart(
	block: Record<string, unknown>,
	streamedReasoning: string | null,
): readonly AgentMessagePart[] {
	const blockType = readString(block.type);

	if (blockType === 'text') {
		const text = readString(block.text);
		return text ? [{ kind: 'text', text }] : [];
	}

	if (blockType === 'thinking') {
		// Kept even when it and its deltas both came through empty: a turn that
		// reasoned should say so rather than vanish the way a dropped part does.
		return [
			{
				kind: 'reasoning',
				text: readString(block.thinking) ?? streamedReasoning ?? '',
			},
		];
	}

	if (blockType === 'tool_use') {
		return [toToolCallPart(block)];
	}

	return [];
}

/**
 * Projects a `tool_use` block onto a tool-call part, naming the call after the
 * tool when the block carries no id of its own.
 * @param block - A `tool_use` entry from a message's `content` array.
 * @returns The tool-call part.
 */
function toToolCallPart(block: Record<string, unknown>): AgentMessagePart {
	const name = readString(block.name) ?? 'tool';
	return {
		input: isRecord(block.input) ? block.input : {},
		kind: 'tool-call',
		name,
		toolCallId: readString(block.id) ?? name,
	};
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
