/**
 * Zod schemas for the Pi RPC stdout stream, derived from the raw captures in
 * `tests/fixtures/pi-captures/` (see `docs/pi/event-taxonomy.md`).
 *
 * Every schema cites the fixture(s) proving its shape. Objects are `loose` on
 * purpose: pi may add fields between versions and unknown fields must never
 * break parsing. Event types or delta types that were NOT observed in any
 * fixture are deliberately absent — they fall through to the unknown-frame
 * fallback in `parse.ts` instead of being guessed from docs.
 */

import { z } from 'zod';

/** Text content block. Fixture: plain-answer.jsonl (assistant message_end). */
const piTextBlockSchema = z.looseObject({
	type: z.literal('text'),
	text: z.string(),
});

/**
 * Thinking content block. `thinking` was always empty in captures; only the
 * encrypted `thinkingSignature` is populated. Fixture: thinking.jsonl.
 */
const piThinkingBlockSchema = z.looseObject({
	type: z.literal('thinking'),
	thinking: z.string(),
	thinkingSignature: z.string().optional(),
});

/** Tool-call content block. Fixture: multi-tool-chain.jsonl (toolcall_end). */
const piToolCallBlockSchema = z.looseObject({
	type: z.literal('toolCall'),
	id: z.string(),
	name: z.string(),
	arguments: z.record(z.string(), z.unknown()),
});

/** Assistant message content union. Fixtures: all (message_end:assistant). */
const piAssistantBlockSchema = z.discriminatedUnion('type', [
	piTextBlockSchema,
	piThinkingBlockSchema,
	piToolCallBlockSchema,
]);

/**
 * Token usage attached to assistant messages. `totalTokens` and the nested
 * `cost` object are undocumented but present in every capture.
 * Fixture: plain-answer.jsonl.
 */
const piUsageSchema = z.looseObject({
	input: z.number().optional(),
	output: z.number().optional(),
	cacheRead: z.number().optional(),
	cacheWrite: z.number().optional(),
	totalTokens: z.number().optional(),
	cost: z
		.looseObject({
			input: z.number().optional(),
			output: z.number().optional(),
			cacheRead: z.number().optional(),
			cacheWrite: z.number().optional(),
			total: z.number().optional(),
		})
		.optional(),
});

/**
 * User message. `content` was always an array of typed blocks in captures;
 * the documented bare-string form is kept because docs/rpc.md guarantees it.
 * Fixture: plain-answer.jsonl (message_start:user).
 */
const piUserMessageSchema = z.looseObject({
	role: z.literal('user'),
	content: z.union([
		z.string(),
		z.array(z.looseObject({ type: z.string(), text: z.string().optional() })),
	]),
	timestamp: z.number().optional(),
});

/**
 * Assistant message. `stopReason` observed values: "stop", "toolUse",
 * "aborted" (abort-mid-turn.jsonl); kept as string so unseen reasons cannot
 * fail the parse. `responseId` is undocumented but always present.
 * Fixture: plain-answer.jsonl (message_end:assistant).
 */
const piAssistantMessageSchema = z.looseObject({
	role: z.literal('assistant'),
	content: z.array(piAssistantBlockSchema),
	api: z.string().optional(),
	provider: z.string().optional(),
	model: z.string().optional(),
	usage: piUsageSchema.optional(),
	stopReason: z.string().optional(),
	timestamp: z.number().optional(),
	responseId: z.string().optional(),
});

/** Tool result message. Fixture: single-read.jsonl (message_end:toolResult). */
const piToolResultMessageSchema = z.looseObject({
	role: z.literal('toolResult'),
	toolCallId: z.string(),
	toolName: z.string(),
	content: z.array(
		z.looseObject({ type: z.string(), text: z.string().optional() }),
	),
	isError: z.boolean().optional(),
	timestamp: z.number().optional(),
});

/**
 * Extension-injected context message (e.g. `customType: "context7_docs"`).
 * Pure context injection — classified as timeline noise.
 * Fixture: markdown-heavy.jsonl (message_start:custom).
 */
const piCustomMessageSchema = z.looseObject({
	role: z.literal('custom'),
	customType: z.string(),
	content: z.unknown().optional(),
	timestamp: z.number().optional(),
});

/** Any message pi attaches to message/turn/agent events. Fixtures: all. */
const piAgentMessageSchema = z.discriminatedUnion('role', [
	piUserMessageSchema,
	piAssistantMessageSchema,
	piToolResultMessageSchema,
	piCustomMessageSchema,
]);

/**
 * Streaming delta variants observed inside `message_update`. The documented
 * `start`/`done`/`error`/`thinking_delta` variants never appeared in any
 * capture and are intentionally not modelled; unknown variants surface as a
 * typed fallback. The bulky `partial` snapshot field is tolerated but not
 * modelled — items fold deltas instead. Fixtures: plain-answer.jsonl (text),
 * thinking.jsonl (thinking), multi-tool-chain.jsonl (toolcall).
 */
const piAssistantDeltaSchema = z.union([
	z.looseObject({ type: z.literal('text_start'), contentIndex: z.number() }),
	z.looseObject({
		type: z.literal('text_delta'),
		contentIndex: z.number(),
		delta: z.string(),
	}),
	z.looseObject({
		type: z.literal('text_end'),
		contentIndex: z.number(),
		content: z.string().optional(),
	}),
	z.looseObject({
		type: z.literal('thinking_start'),
		contentIndex: z.number(),
	}),
	z.looseObject({
		type: z.literal('thinking_end'),
		contentIndex: z.number(),
		content: z.string().optional(),
	}),
	z.looseObject({
		type: z.literal('toolcall_start'),
		contentIndex: z.number(),
	}),
	z.looseObject({
		type: z.literal('toolcall_delta'),
		contentIndex: z.number(),
		delta: z.string(),
	}),
	z.looseObject({
		type: z.literal('toolcall_end'),
		contentIndex: z.number(),
		toolCall: piToolCallBlockSchema,
	}),
]);

/**
 * Accumulated tool output payload used by both `tool_execution_update`
 * (`partialResult`, may have empty `content`) and `tool_execution_end`
 * (`result`). `details` carries tool-specific keys: edit → diff/patch/
 * firstChangedLine, read → filePath/truncated, lsp_diagnostics →
 * diagnostics/severity. Fixtures: long-output.jsonl, file-edit.jsonl.
 */
const piToolPayloadSchema = z.looseObject({
	content: z.array(
		z.looseObject({ type: z.string(), text: z.string().optional() }),
	),
	details: z.record(z.string(), z.unknown()).optional(),
});

/** `agent_start` — no payload. Fixtures: all. */
const piAgentStartSchema = z.looseObject({
	type: z.literal('agent_start'),
});

/**
 * `agent_end` — authoritative message list for the run. `willRetry` is
 * undocumented but always present. Fires even after an abort. Fixtures: all;
 * abort behavior: abort-mid-turn.jsonl.
 */
const piAgentEndSchema = z.looseObject({
	type: z.literal('agent_end'),
	messages: z.array(piAgentMessageSchema),
	willRetry: z.boolean().optional(),
});

/** `turn_start` — inner LLM-call boundary, no payload. Fixtures: all. */
const piTurnStartSchema = z.looseObject({
	type: z.literal('turn_start'),
});

/** `turn_end` — assistant message plus its tool results. Fixtures: all. */
const piTurnEndSchema = z.looseObject({
	type: z.literal('turn_end'),
	message: piAgentMessageSchema,
	toolResults: z.array(piToolResultMessageSchema),
});

/** `message_start` — a message began. Fixtures: all. */
const piMessageStartSchema = z.looseObject({
	type: z.literal('message_start'),
	message: piAgentMessageSchema,
});

/** `message_update` — streaming assistant delta. Fixtures: all. */
const piMessageUpdateSchema = z.looseObject({
	type: z.literal('message_update'),
	message: piAgentMessageSchema,
	assistantMessageEvent: piAssistantDeltaSchema,
});

/** `message_end` — authoritative completed message. Fixtures: all. */
const piMessageEndSchema = z.looseObject({
	type: z.literal('message_end'),
	message: piAgentMessageSchema,
});

/** `tool_execution_start`. Fixture: single-read.jsonl. */
const piToolExecutionStartSchema = z.looseObject({
	type: z.literal('tool_execution_start'),
	toolCallId: z.string(),
	toolName: z.string(),
	args: z.record(z.string(), z.unknown()),
});

/**
 * `tool_execution_update` — `partialResult` is the ACCUMULATED output so far,
 * not a delta (verified: long-output.jsonl). Fixture: long-output.jsonl.
 */
const piToolExecutionUpdateSchema = z.looseObject({
	type: z.literal('tool_execution_update'),
	toolCallId: z.string(),
	toolName: z.string(),
	args: z.record(z.string(), z.unknown()).optional(),
	partialResult: piToolPayloadSchema,
});

/**
 * `tool_execution_end` — `isError: true` covers both real failures
 * (failing-tool.jsonl, exit 127) and extension-denied calls
 * (permission-gate.jsonl, "Denied by user"). Fixtures: single-read.jsonl,
 * failing-tool.jsonl, permission-gate.jsonl.
 */
const piToolExecutionEndSchema = z.looseObject({
	type: z.literal('tool_execution_end'),
	toolCallId: z.string(),
	toolName: z.string(),
	result: piToolPayloadSchema,
	isError: z.boolean(),
});

/**
 * Session stats payload answered to `get_session_stats` — the status-bar
 * source (tokens, cost, context usage). Fixture: multi-tool-chain.jsonl
 * (response:get_session_stats).
 */
export const piSessionStatsSchema = z.looseObject({
	sessionId: z.string().optional(),
	userMessages: z.number().optional(),
	assistantMessages: z.number().optional(),
	toolCalls: z.number().optional(),
	totalMessages: z.number().optional(),
	tokens: z
		.looseObject({
			input: z.number().optional(),
			output: z.number().optional(),
			cacheRead: z.number().optional(),
			cacheWrite: z.number().optional(),
			total: z.number().optional(),
		})
		.optional(),
	cost: z.number().optional(),
	contextUsage: z
		.looseObject({
			tokens: z.number().nullable().optional(),
			contextWindow: z.number().optional(),
			percent: z.number().nullable().optional(),
		})
		.optional(),
});

/**
 * Command acknowledgment. `id` echoes the request id when one was sent;
 * `data` is command-specific (use `piSessionStatsSchema` for
 * `command === "get_session_stats"`). Fixtures: all (response:prompt),
 * abort-mid-turn.jsonl (response:abort).
 */
const piResponseSchema = z.looseObject({
	type: z.literal('response'),
	command: z.string(),
	success: z.boolean(),
	id: z.string().optional(),
	error: z.string().optional(),
	data: z.unknown().optional(),
});

/**
 * Extension UI traffic. Observed methods: `confirm` (dialog handshake —
 * blocks until an `extension_ui_response` with the same `id` is written to
 * stdin; permission-gate.jsonl), `notify` and `setStatus` (fire-and-forget,
 * all fixtures; `statusText` may embed ANSI codes). Unobserved dialog
 * methods (select/input/editor) intentionally fall into the generic arm.
 */
const piExtensionUiRequestSchema = z.union([
	z.looseObject({
		type: z.literal('extension_ui_request'),
		id: z.string(),
		method: z.literal('confirm'),
		title: z.string(),
		message: z.string().optional(),
		timeout: z.number().optional(),
	}),
	z.looseObject({
		type: z.literal('extension_ui_request'),
		id: z.string(),
		method: z.literal('notify'),
		message: z.string(),
		notifyType: z.string().optional(),
	}),
	z.looseObject({
		type: z.literal('extension_ui_request'),
		id: z.string(),
		method: z.literal('setStatus'),
		statusKey: z.string(),
		statusText: z.string().optional(),
	}),
	z.looseObject({
		type: z.literal('extension_ui_request'),
		id: z.string(),
		method: z.string(),
	}),
]);

/** Every stdout frame shape observed across the fixture matrix. */
export const piRpcEventSchema = z.union([
	piAgentStartSchema,
	piAgentEndSchema,
	piTurnStartSchema,
	piTurnEndSchema,
	piMessageStartSchema,
	piMessageUpdateSchema,
	piMessageEndSchema,
	piToolExecutionStartSchema,
	piToolExecutionUpdateSchema,
	piToolExecutionEndSchema,
	piResponseSchema,
	piExtensionUiRequestSchema,
]);

/**
 * One captured fixture line as written by
 * `scripts/capture-pi-fixtures.ts`: capture timestamp, source stream, and
 * the verbatim raw line.
 */
export const piCapturedLineSchema = z.object({
	ts: z.number(),
	stream: z.enum(['stdout', 'stderr']),
	raw: z.string(),
});

export type PiTextBlock = z.infer<typeof piTextBlockSchema>;
export type PiThinkingBlock = z.infer<typeof piThinkingBlockSchema>;
export type PiToolCallBlock = z.infer<typeof piToolCallBlockSchema>;
export type PiAssistantBlock = z.infer<typeof piAssistantBlockSchema>;
export type PiUserMessage = z.infer<typeof piUserMessageSchema>;
export type PiAssistantMessage = z.infer<typeof piAssistantMessageSchema>;
export type PiToolResultMessage = z.infer<typeof piToolResultMessageSchema>;
export type PiCustomMessage = z.infer<typeof piCustomMessageSchema>;
export type PiAgentMessage = z.infer<typeof piAgentMessageSchema>;
export type PiAssistantDelta = z.infer<typeof piAssistantDeltaSchema>;
export type PiToolPayload = z.infer<typeof piToolPayloadSchema>;
export type PiSessionStats = z.infer<typeof piSessionStatsSchema>;
export type PiResponseFrame = z.infer<typeof piResponseSchema>;
export type PiExtensionUiRequest = z.infer<typeof piExtensionUiRequestSchema>;
export type PiRpcEvent = z.infer<typeof piRpcEventSchema>;
export type PiCapturedLine = z.infer<typeof piCapturedLineSchema>;
