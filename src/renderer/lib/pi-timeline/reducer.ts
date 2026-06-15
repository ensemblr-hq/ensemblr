/**
 * Pure, total reducer from parsed Pi RPC events to the UI-facing timeline
 * model. Deterministic: ids come from a counter and all timestamps from the
 * caller, so replaying a fixture twice yields identical state. Behavior is
 * derived from the capture matrix — see `docs/pi/event-taxonomy.md` for the
 * timeline/metadata/noise classification each branch implements.
 */

import type {
	PiAssistantMessageItem,
	PiThinkingItem,
	PiTimelineInput,
	PiTimelineItem,
	PiTimelineState,
	PiToolCallItem,
	PiToolGroupItem,
} from '@/renderer/types/pi-timeline';
import type {
	PiAgentMessage,
	PiRpcEvent,
	PiToolPayload,
} from '@/shared/pi-rpc';
import { piSessionStatsSchema } from '@/shared/pi-rpc';

// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC is exactly the character ANSI stripping targets.
const ANSI_PATTERN = /\u001b\[[0-9;]*[A-Za-z]/g;

/** Returns the empty timeline state a new session starts from. */
export function createPiTimelineState(): PiTimelineState {
	return {
		items: [],
		session: {
			model: null,
			stats: null,
			statusTexts: {},
			streaming: false,
			turnStartedAtMs: null,
		},
		cursor: {
			nextItemId: 1,
			openAssistantId: null,
			openThinkingId: null,
			runningTools: {},
			pendingTurnStartMs: null,
			lastAnswerText: '',
			turnAborted: false,
		},
	};
}

/**
 * Applies one timestamped Pi RPC event to the timeline state. Total: every
 * known event maps to a new state (often unchanged); unknown frames never
 * reach the reducer because the parser filters them.
 *
 * @param state - Current timeline state.
 * @param input - Parsed event plus its capture/arrival timestamp.
 * @returns The next state; `state` itself when the event is a no-op.
 */
export function reducePiTimeline(
	state: PiTimelineState,
	input: PiTimelineInput,
): PiTimelineState {
	const { atMs, event } = input;
	switch (event.type) {
		case 'response':
			return reduceResponse(state, event, atMs);
		case 'agent_start':
			return reduceAgentStart(state, atMs);
		case 'agent_end':
			return reduceAgentEnd(state, event.messages, atMs);
		case 'turn_start':
		case 'turn_end':
			return state;
		case 'message_start':
			return reduceMessageStart(state, event.message, atMs);
		case 'message_update':
			return reduceDelta(state, event.assistantMessageEvent, atMs);
		case 'message_end':
			return reduceMessageEnd(state, event.message, atMs);
		case 'tool_execution_start':
			return appendToolCall(state, {
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
				atMs,
			});
		case 'tool_execution_update':
			// A streaming update also proves an awaited approval was granted.
			return updateToolCall(state, event.toolCallId, (call) => ({
				...call,
				output: payloadText(event.partialResult),
				status: call.status === 'awaiting-approval' ? 'running' : call.status,
				approval:
					call.approval && call.approval.settledAtMs === null
						? { ...call.approval, settledAtMs: atMs }
						: call.approval,
			}));
		case 'tool_execution_end':
			return finishToolCall(state, event, atMs);
		case 'extension_ui_request':
			return reduceUiRequest(state, event, atMs);
		default:
			return state;
	}
}

/** Joins the plain-text blocks of a tool payload (accumulated, not delta). */
function payloadText(payload: PiToolPayload): string {
	return payload.content
		.map((block) => (block.type === 'text' ? (block.text ?? '') : ''))
		.join('');
}

/** Extracts user-visible text from a user/assistant message content. */
function messageText(message: PiAgentMessage): string {
	if (message.role === 'user') {
		if (typeof message.content === 'string') {
			return message.content;
		}
		return message.content
			.flatMap((block) => (block.text ? [block.text] : []))
			.join('\n');
	}
	if (message.role === 'assistant') {
		return message.content
			.flatMap((block) =>
				block.type === 'text' && block.text ? [block.text] : [],
			)
			.join('\n');
	}
	return '';
}

function nextId(state: PiTimelineState): [string, number] {
	return [`item-${state.cursor.nextItemId}`, state.cursor.nextItemId + 1];
}

function replaceItem(
	items: readonly PiTimelineItem[],
	id: string,
	update: (item: PiTimelineItem) => PiTimelineItem,
): readonly PiTimelineItem[] {
	return items.map((item) => (item.id === id ? update(item) : item));
}

function reduceResponse(
	state: PiTimelineState,
	event: Extract<PiRpcEvent, { type: 'response' }>,
	atMs: number,
): PiTimelineState {
	if (event.command === 'prompt' && event.success && !state.session.streaming) {
		return {
			...state,
			cursor: { ...state.cursor, pendingTurnStartMs: atMs },
		};
	}
	if (event.command === 'get_session_stats' && event.success && event.data) {
		const stats = piSessionStatsSchema.safeParse(event.data);
		if (stats.success) {
			return {
				...state,
				session: { ...state.session, stats: stats.data },
			};
		}
	}
	return state;
}

function reduceAgentStart(
	state: PiTimelineState,
	atMs: number,
): PiTimelineState {
	return {
		...state,
		session: {
			...state.session,
			streaming: true,
			turnStartedAtMs: state.cursor.pendingTurnStartMs ?? atMs,
		},
		cursor: {
			...state.cursor,
			pendingTurnStartMs: null,
			lastAnswerText: '',
			turnAborted: false,
		},
	};
}

/**
 * Seals every open item (streaming text, thinking, running tools → cancelled)
 * and appends the turn footer with the turn duration and copyable answer.
 */
function reduceAgentEnd(
	state: PiTimelineState,
	messages: readonly PiAgentMessage[],
	atMs: number,
): PiTimelineState {
	let items = state.items;
	let { lastAnswerText } = state.cursor;
	if (state.cursor.openThinkingId) {
		items = replaceItem(items, state.cursor.openThinkingId, (item) =>
			item.kind === 'thinking' ? { ...item, endedAtMs: atMs } : item,
		);
	}
	if (state.cursor.openAssistantId) {
		items = replaceItem(items, state.cursor.openAssistantId, (item) => {
			if (item.kind !== 'assistant-message') {
				return item;
			}
			lastAnswerText = item.text;
			return { ...item, streaming: false };
		});
	}
	for (const itemId of Object.values(state.cursor.runningTools)) {
		items = replaceItem(items, itemId, (item) =>
			mapToolCalls(item, (call) =>
				call.endedAtMs === null
					? {
							...call,
							status: 'cancelled',
							endedAtMs: atMs,
							approval: call.approval
								? { ...call.approval, settledAtMs: atMs }
								: null,
						}
					: call,
			),
		);
	}
	const lastAssistant = [...messages]
		.reverse()
		.find((message) => message.role === 'assistant');
	const aborted =
		state.cursor.turnAborted || lastAssistant?.stopReason === 'aborted';
	const startMs = state.session.turnStartedAtMs ?? atMs;
	const [footerId, nextItemId] = nextId({ ...state, items });
	const footer: PiTimelineItem = {
		id: footerId,
		kind: 'turn-footer',
		durationMs: Math.max(0, atMs - startMs),
		aborted,
		answerText: lastAnswerText,
	};
	return {
		items: [...items, footer],
		session: {
			...state.session,
			model: lastAssistant?.model ?? state.session.model,
			streaming: false,
			turnStartedAtMs: null,
		},
		cursor: {
			...state.cursor,
			nextItemId,
			openAssistantId: null,
			openThinkingId: null,
			runningTools: {},
			lastAnswerText,
		},
	};
}

function reduceMessageStart(
	state: PiTimelineState,
	message: PiAgentMessage,
	atMs: number,
): PiTimelineState {
	// `custom` (extension context injections), `toolResult`, and `assistant`
	// starts produce no item — assistant items are created lazily by deltas.
	if (message.role !== 'user') {
		return state;
	}
	const [id, nextItemId] = nextId(state);
	const item: PiTimelineItem = {
		id,
		kind: 'user-message',
		text: messageText(message),
		atMs,
	};
	return {
		...state,
		items: [...state.items, item],
		cursor: { ...state.cursor, nextItemId },
	};
}

function reduceMessageEnd(
	state: PiTimelineState,
	message: PiAgentMessage,
	atMs: number,
): PiTimelineState {
	if (message.role !== 'assistant') {
		return state;
	}
	let next = state;
	// Abort can seal the message without a closing text_end — flush the still
	// open assistant item with the accumulated text (abort-mid-turn.jsonl).
	if (state.cursor.openAssistantId) {
		const items = replaceItem(
			state.items,
			state.cursor.openAssistantId,
			(item) =>
				item.kind === 'assistant-message'
					? { ...item, streaming: false }
					: item,
		);
		next = {
			...next,
			items,
			cursor: { ...next.cursor, openAssistantId: null },
		};
	}
	const text = messageText(message);
	if (text.length > 0 && !next.items.some(isOpenStreamFor(text))) {
		// No-stream fallback: a finished assistant message whose text never
		// streamed (not observed in captures, but message_end is authoritative).
		const alreadyStreamed = next.cursor.lastAnswerText === text;
		if (!alreadyStreamed && !hasSealedText(next.items, text)) {
			const [id, nextItemId] = nextId(next);
			const item: PiTimelineItem = {
				id,
				kind: 'assistant-message',
				text,
				streaming: false,
				atMs,
			};
			next = {
				...next,
				items: [...next.items, item],
				cursor: { ...next.cursor, nextItemId, lastAnswerText: text },
			};
		}
	}
	return {
		...next,
		session: {
			...next.session,
			model: message.model ?? next.session.model,
		},
		cursor: {
			...next.cursor,
			turnAborted: next.cursor.turnAborted || message.stopReason === 'aborted',
		},
	};
}

function isOpenStreamFor(text: string) {
	return (item: PiTimelineItem) =>
		item.kind === 'assistant-message' && item.streaming && item.text === text;
}

function hasSealedText(
	items: readonly PiTimelineItem[],
	text: string,
): boolean {
	for (let index = items.length - 1; index >= 0; index -= 1) {
		const item = items[index];
		if (item?.kind === 'turn-footer') {
			break;
		}
		if (
			item?.kind === 'assistant-message' &&
			!item.streaming &&
			item.text === text
		) {
			return true;
		}
	}
	return false;
}

function reduceDelta(
	state: PiTimelineState,
	delta: Extract<
		PiRpcEvent,
		{ type: 'message_update' }
	>['assistantMessageEvent'],
	atMs: number,
): PiTimelineState {
	switch (delta.type) {
		case 'thinking_start': {
			const [id, nextItemId] = nextId(state);
			const item: PiThinkingItem = {
				id,
				kind: 'thinking',
				startedAtMs: atMs,
				endedAtMs: null,
			};
			return {
				...state,
				items: [...state.items, item],
				cursor: { ...state.cursor, nextItemId, openThinkingId: id },
			};
		}
		case 'thinking_end': {
			if (!state.cursor.openThinkingId) {
				return state;
			}
			const items = replaceItem(
				state.items,
				state.cursor.openThinkingId,
				(item) =>
					item.kind === 'thinking' ? { ...item, endedAtMs: atMs } : item,
			);
			return {
				...state,
				items,
				cursor: { ...state.cursor, openThinkingId: null },
			};
		}
		case 'text_start': {
			const [id, nextItemId] = nextId(state);
			const item: PiAssistantMessageItem = {
				id,
				kind: 'assistant-message',
				text: '',
				streaming: true,
				atMs,
			};
			return {
				...state,
				items: [...state.items, item],
				cursor: { ...state.cursor, nextItemId, openAssistantId: id },
			};
		}
		case 'text_delta': {
			if (!state.cursor.openAssistantId) {
				return state;
			}
			const items = replaceItem(
				state.items,
				state.cursor.openAssistantId,
				(item) =>
					item.kind === 'assistant-message'
						? { ...item, text: item.text + delta.delta }
						: item,
			);
			return { ...state, items };
		}
		case 'text_end': {
			if (!state.cursor.openAssistantId) {
				return state;
			}
			let sealedText = '';
			const items = replaceItem(
				state.items,
				state.cursor.openAssistantId,
				(item) => {
					if (item.kind !== 'assistant-message') {
						return item;
					}
					sealedText = delta.content ?? item.text;
					return { ...item, text: sealedText, streaming: false };
				},
			);
			return {
				...state,
				items,
				cursor: {
					...state.cursor,
					openAssistantId: null,
					lastAnswerText: sealedText,
				},
			};
		}
		// Tool-call argument streaming is not rendered; the tool item is
		// created by tool_execution_start which carries the complete args.
		case 'toolcall_start':
		case 'toolcall_delta':
		case 'toolcall_end':
			return state;
		default:
			return state;
	}
}

/** Applies `update` to a tool-call item or to each call inside a group. */
function mapToolCalls(
	item: PiTimelineItem,
	update: (call: PiToolCallItem) => PiToolCallItem,
): PiTimelineItem {
	if (item.kind === 'tool-call') {
		return update(item);
	}
	if (item.kind === 'tool-group') {
		return { ...item, calls: item.calls.map(update) };
	}
	return item;
}

/**
 * Appends a running tool call, folding it into the previous item when that
 * item is a tool call or group (consecutive calls with no assistant text in
 * between group together).
 */
function appendToolCall(
	state: PiTimelineState,
	start: {
		toolCallId: string;
		toolName: string;
		args: Readonly<Record<string, unknown>>;
		atMs: number;
	},
): PiTimelineState {
	const [id, nextItemId] = nextId(state);
	const call: PiToolCallItem = {
		id,
		kind: 'tool-call',
		toolCallId: start.toolCallId,
		toolName: start.toolName,
		args: start.args,
		output: '',
		details: null,
		status: 'running',
		approval: null,
		startedAtMs: start.atMs,
		endedAtMs: null,
	};
	const last = state.items.at(-1);
	if (last?.kind === 'tool-call') {
		const [groupId, afterGroupId] = [`item-${nextItemId}`, nextItemId + 1];
		const group: PiToolGroupItem = {
			id: groupId,
			kind: 'tool-group',
			calls: [last, call],
		};
		const runningTools: Record<string, string> = {};
		for (const [toolCallId, itemId] of Object.entries(
			state.cursor.runningTools,
		)) {
			runningTools[toolCallId] = itemId === last.id ? groupId : itemId;
		}
		runningTools[start.toolCallId] = groupId;
		return {
			...state,
			items: [...state.items.slice(0, -1), group],
			cursor: { ...state.cursor, nextItemId: afterGroupId, runningTools },
		};
	}
	if (last?.kind === 'tool-group') {
		const group: PiToolGroupItem = { ...last, calls: [...last.calls, call] };
		return {
			...state,
			items: [...state.items.slice(0, -1), group],
			cursor: {
				...state.cursor,
				nextItemId,
				runningTools: {
					...state.cursor.runningTools,
					[start.toolCallId]: last.id,
				},
			},
		};
	}
	return {
		...state,
		items: [...state.items, call],
		cursor: {
			...state.cursor,
			nextItemId,
			runningTools: { ...state.cursor.runningTools, [start.toolCallId]: id },
		},
	};
}

/** Updates the (possibly grouped) tool call identified by `toolCallId`. */
function updateToolCall(
	state: PiTimelineState,
	toolCallId: string,
	update: (call: PiToolCallItem) => PiToolCallItem,
): PiTimelineState {
	const itemId = state.cursor.runningTools[toolCallId];
	if (!itemId) {
		return state;
	}
	const items = replaceItem(state.items, itemId, (item) =>
		mapToolCalls(item, (call) =>
			call.toolCallId === toolCallId ? update(call) : call,
		),
	);
	return { ...state, items };
}

function finishToolCall(
	state: PiTimelineState,
	event: Extract<PiRpcEvent, { type: 'tool_execution_end' }>,
	atMs: number,
): PiTimelineState {
	const next = updateToolCall(state, event.toolCallId, (call) => ({
		...call,
		output: payloadText(event.result),
		details: event.result.details ?? null,
		status: event.isError ? 'error' : 'success',
		endedAtMs: atMs,
		approval: call.approval
			? { ...call.approval, settledAtMs: call.approval.settledAtMs ?? atMs }
			: null,
	}));
	const runningTools = { ...next.cursor.runningTools };
	delete runningTools[event.toolCallId];
	return { ...next, cursor: { ...next.cursor, runningTools } };
}

function reduceUiRequest(
	state: PiTimelineState,
	event: Extract<PiRpcEvent, { type: 'extension_ui_request' }>,
	atMs: number,
): PiTimelineState {
	// The schema's generic fallback arm widens method-specific fields, so
	// narrow with runtime guards instead of `in` checks.
	const statusKey =
		'statusKey' in event && typeof event.statusKey === 'string'
			? event.statusKey
			: null;
	if (event.method === 'setStatus' && statusKey !== null) {
		const statusTexts = { ...state.session.statusTexts };
		const text =
			'statusText' in event && typeof event.statusText === 'string'
				? event.statusText.replace(ANSI_PATTERN, '').trim()
				: '';
		if (text.length === 0) {
			delete statusTexts[statusKey];
		} else {
			statusTexts[statusKey] = text;
		}
		return { ...state, session: { ...state.session, statusTexts } };
	}
	const title =
		'title' in event && typeof event.title === 'string' ? event.title : null;
	if (event.method === 'confirm' && title !== null) {
		// Attach the approval to the most recently started running tool — the
		// confirm fires from a tool_call hook while that tool is preflighting
		// (permission-gate.jsonl).
		const runningIds = Object.keys(state.cursor.runningTools);
		const lastToolCallId = runningIds.at(-1);
		if (!lastToolCallId) {
			return state;
		}
		return updateToolCall(state, lastToolCallId, (call) => ({
			...call,
			status: 'awaiting-approval',
			approval: {
				title,
				message:
					'message' in event && typeof event.message === 'string'
						? event.message
						: null,
				requestedAtMs: atMs,
				settledAtMs: null,
			},
		}));
	}
	// notify and the unobserved dialog methods are timeline noise.
	return state;
}
