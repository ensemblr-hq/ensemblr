import assert from 'node:assert/strict';
import test from 'node:test';

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '../../src/main/agent-runtime/agent-types.ts';
import { detectPlanSubmission } from '../../src/main/claude-agent/claude-plan-mode.ts';
import {
	createSdkMessageNormalizer,
	type SdkSessionDiscovery,
} from '../../src/main/claude-agent/sdk-message-normalizer.ts';

const NOW = new Date('2026-08-06T12:00:00.000Z');

function createNormalizer(): {
	discoveries: SdkSessionDiscovery[];
	normalize: (message: unknown) => readonly AgentEvent[];
	setTurnId: (turnId: string | null) => void;
} {
	const discoveries: SdkSessionDiscovery[] = [];
	const normalizer = createSdkMessageNormalizer({
		now: () => NOW,
		onDiscovery: (discovery) => discoveries.push(discovery),
	});
	return {
		discoveries,
		normalize: (message) => normalizer.normalize(message as SDKMessage),
		setTurnId: (turnId) => normalizer.setTurnId(turnId),
	};
}

function initMessage(overrides: Record<string, unknown> = {}): unknown {
	return {
		model: 'claude-opus-5',
		session_id: 'sdk-session-1',
		subtype: 'init',
		type: 'system',
		...overrides,
	};
}

function messagePayloads(
	events: readonly AgentEvent[],
): readonly { kind: string }[] {
	return events.flatMap((event) =>
		event.type === 'message' ? [event.payload] : [],
	);
}

test('init reports the resolved session id and model, then settles to idle', () => {
	const { discoveries, normalize } = createNormalizer();

	const events = normalize(initMessage());

	assert.deepEqual(discoveries, [
		{
			model: { id: 'claude-opus-5', provider: 'anthropic' },
			sessionId: 'sdk-session-1',
		},
	]);
	assert.deepEqual(events, [
		{
			at: NOW.toISOString(),
			previous: 'starting',
			status: 'idle',
			type: 'status',
		},
	]);
});

test('a text_delta stream event becomes a broadcast-only text-delta', () => {
	const { normalize, setTurnId } = createNormalizer();
	normalize(initMessage());
	setTurnId('turn-1');

	const events = normalize({
		event: {
			delta: { text: 'Hel', type: 'text_delta' },
			index: 0,
			type: 'content_block_delta',
		},
		type: 'stream_event',
	});

	assert.deepEqual(events, [
		{
			at: NOW.toISOString(),
			payload: { kind: 'text-delta', text: 'Hel' },
			role: 'agent',
			turnId: 'turn-1',
			type: 'message',
		},
	]);
});

test('a thinking_delta stream event becomes a reasoning-delta', () => {
	const { normalize } = createNormalizer();
	normalize(initMessage());

	const events = normalize({
		event: {
			delta: { thinking: 'weighing', type: 'thinking_delta' },
			index: 0,
			type: 'content_block_delta',
		},
		type: 'stream_event',
	});

	assert.deepEqual(messagePayloads(events), [
		{ kind: 'reasoning-delta', text: 'weighing' },
	]);
});

test('tool-argument deltas are dropped — the wire union has no partial-input variant', () => {
	const { normalize } = createNormalizer();
	normalize(initMessage());

	const events = normalize({
		event: {
			delta: { partial_json: '{"pa', type: 'input_json_delta' },
			index: 1,
			type: 'content_block_delta',
		},
		type: 'stream_event',
	});

	assert.deepEqual(events, []);
});

test('block start and stop events have no timeline effect of their own', () => {
	const { normalize } = createNormalizer();
	normalize(initMessage());

	assert.deepEqual(
		normalize({
			event: {
				content_block: { type: 'text' },
				index: 0,
				type: 'content_block_start',
			},
			type: 'stream_event',
		}),
		[],
	);
	assert.deepEqual(
		normalize({
			event: { index: 0, type: 'content_block_stop' },
			type: 'stream_event',
		}),
		[],
	);
});

test('an assistant message seals the turn and opens a card per tool_use block', () => {
	const { normalize, setTurnId } = createNormalizer();
	normalize(initMessage());
	setTurnId('turn-1');

	const events = normalize({
		message: {
			content: [
				{ text: 'Reading the file.', type: 'text' },
				{
					id: 'toolu_1',
					input: { path: 'README.md' },
					name: 'Read',
					type: 'tool_use',
				},
			],
		},
		parent_tool_use_id: null,
		type: 'assistant',
	});

	assert.deepEqual(events[0], {
		at: NOW.toISOString(),
		previous: 'idle',
		status: 'streaming',
		type: 'status',
	});
	assert.deepEqual(messagePayloads(events), [
		{
			kind: 'message',
			parts: [
				{ kind: 'text', text: 'Reading the file.' },
				{
					input: { path: 'README.md' },
					kind: 'tool-call',
					name: 'Read',
					toolCallId: 'toolu_1',
				},
			],
			role: 'assistant',
		},
		{
			input: { path: 'README.md' },
			kind: 'tool-call',
			name: 'Read',
			toolCallId: 'toolu_1',
		},
	]);
});

test('thinking blocks on an assistant message become reasoning parts', () => {
	const { normalize } = createNormalizer();
	normalize(initMessage());

	const events = normalize({
		message: { content: [{ thinking: 'considering', type: 'thinking' }] },
		parent_tool_use_id: null,
		type: 'assistant',
	});

	assert.deepEqual(messagePayloads(events), [
		{
			kind: 'message',
			parts: [{ kind: 'reasoning', text: 'considering' }],
			role: 'assistant',
		},
	]);
});

test('a user message carrying tool_result blocks lands as tool-result, not prose', () => {
	const { normalize } = createNormalizer();
	normalize(initMessage());

	const events = normalize({
		message: {
			content: [
				{
					content: '# Ensemblr',
					is_error: false,
					tool_use_id: 'toolu_1',
					type: 'tool_result',
				},
			],
		},
		parent_tool_use_id: null,
		type: 'user',
	});

	assert.deepEqual(messagePayloads(events), [
		{
			isError: false,
			kind: 'tool-result',
			output: {
				content: [{ text: '# Ensemblr', type: 'text' }],
				details: null,
			},
			toolCallId: 'toolu_1',
		},
	]);
	assert.equal(
		events.every((event) => event.type !== 'message' || event.role === 'tool'),
		true,
	);
});

test('a failing tool result carries isError', () => {
	const { normalize } = createNormalizer();
	normalize(initMessage());

	const events = normalize({
		message: {
			content: [
				{
					content: 'ENOENT',
					is_error: true,
					tool_use_id: 'toolu_2',
					type: 'tool_result',
				},
			],
		},
		parent_tool_use_id: null,
		type: 'user',
	});

	assert.deepEqual(messagePayloads(events), [
		{
			isError: true,
			kind: 'tool-result',
			output: { content: [{ text: 'ENOENT', type: 'text' }], details: null },
			toolCallId: 'toolu_2',
		},
	]);
});

test('an edit result carries the unified patch its structured hunks describe', () => {
	const { normalize } = createNormalizer();
	normalize(initMessage());

	const events = normalize({
		message: {
			content: [
				{
					content: 'The file has been updated.',
					is_error: false,
					tool_use_id: 'toolu_3',
					type: 'tool_result',
				},
			],
		},
		parent_tool_use_id: null,
		tool_use_result: {
			filePath: '/repo/src/broken.ts',
			newString: 'const x = 1;',
			oldString: 'const x = "1";',
			structuredPatch: [
				{
					lines: [
						' import { a } from "./a";',
						'-const x = "1";',
						'+const x = 1;',
					],
					newLines: 3,
					newStart: 1,
					oldLines: 3,
					oldStart: 1,
				},
			],
		},
		type: 'user',
	});

	assert.deepEqual(messagePayloads(events), [
		{
			isError: false,
			kind: 'tool-result',
			output: {
				content: [{ text: 'The file has been updated.', type: 'text' }],
				details: {
					patch:
						'--- /repo/src/broken.ts\n+++ /repo/src/broken.ts\n@@ -1,3 +1,3 @@\n import { a } from "./a";\n-const x = "1";\n+const x = 1;\n',
				},
			},
			toolCallId: 'toolu_3',
		},
	]);
});

test('a file the tool created carries no patch, since its card shows the content', () => {
	const { normalize } = createNormalizer();
	normalize(initMessage());

	const events = normalize({
		message: {
			content: [
				{
					content: 'File created successfully at: /repo/src/new.ts',
					is_error: false,
					tool_use_id: 'toolu_5',
					type: 'tool_result',
				},
			],
		},
		parent_tool_use_id: null,
		tool_use_result: {
			content: 'const x = 1;',
			filePath: '/repo/src/new.ts',
			structuredPatch: [
				{
					lines: ['+const x = 1;'],
					newLines: 1,
					newStart: 1,
					oldLines: 0,
					oldStart: 1,
				},
			],
			type: 'create',
		},
		type: 'user',
	});

	assert.deepEqual(messagePayloads(events), [
		{
			isError: false,
			kind: 'tool-result',
			output: {
				content: [
					{
						text: 'File created successfully at: /repo/src/new.ts',
						type: 'text',
					},
				],
				details: null,
			},
			toolCallId: 'toolu_5',
		},
	]);
});

test('a file the tool overwrote carries the patch its card renders as a diff', () => {
	const { normalize } = createNormalizer();
	normalize(initMessage());

	const events = normalize({
		message: {
			content: [
				{
					content: 'The file has been updated.',
					is_error: false,
					tool_use_id: 'toolu_6',
					type: 'tool_result',
				},
			],
		},
		parent_tool_use_id: null,
		tool_use_result: {
			content: 'const x = 1;',
			filePath: '/repo/src/broken.ts',
			structuredPatch: [
				{
					lines: ['-const x = "1";', '+const x = 1;'],
					newLines: 1,
					newStart: 1,
					oldLines: 1,
					oldStart: 1,
				},
			],
			type: 'update',
		},
		type: 'user',
	});

	assert.deepEqual(messagePayloads(events), [
		{
			isError: false,
			kind: 'tool-result',
			output: {
				content: [{ text: 'The file has been updated.', type: 'text' }],
				details: {
					patch:
						'--- /repo/src/broken.ts\n+++ /repo/src/broken.ts\n@@ -1,1 +1,1 @@\n-const x = "1";\n+const x = 1;\n',
				},
			},
			toolCallId: 'toolu_6',
		},
	]);
});

test('a structured result describing no hunks leaves the details empty', () => {
	const { normalize } = createNormalizer();
	normalize(initMessage());

	const events = normalize({
		message: {
			content: [
				{
					content: 'Found 3 files',
					is_error: false,
					tool_use_id: 'toolu_4',
					type: 'tool_result',
				},
			],
		},
		parent_tool_use_id: null,
		tool_use_result: { durationMs: 12, filenames: ['a.ts'], numFiles: 1 },
		type: 'user',
	});

	assert.deepEqual(messagePayloads(events), [
		{
			isError: false,
			kind: 'tool-result',
			output: {
				content: [{ text: 'Found 3 files', type: 'text' }],
				details: null,
			},
			toolCallId: 'toolu_4',
		},
	]);
});

test('the SDK echo of a typed prompt is dropped so it renders once, not twice', () => {
	const { normalize } = createNormalizer();
	normalize(initMessage());

	const events = normalize({
		message: { content: 'hello', role: 'user' },
		parent_tool_use_id: null,
		type: 'user',
	});

	assert.deepEqual(messagePayloads(events), []);
});

function assistantMessage(
	usage: Record<string, number> | null,
	overrides: Record<string, unknown> = {},
): unknown {
	return {
		message: {
			content: [{ text: 'done', type: 'text' }],
			...(usage ? { usage } : {}),
		},
		parent_tool_use_id: null,
		type: 'assistant',
		...overrides,
	};
}

function usageSnapshots(events: readonly AgentEvent[]): readonly unknown[] {
	return events.flatMap((event) =>
		event.type === 'context-usage' ? [event.usage] : [],
	);
}

test('context usage measures the live thread, not the session billing totals', () => {
	const { normalize } = createNormalizer();
	normalize(initMessage());
	normalize(
		assistantMessage({
			cache_creation_input_tokens: 5,
			cache_read_input_tokens: 100,
			input_tokens: 1_000,
			output_tokens: 395,
		}),
	);

	const events = normalize({
		modelUsage: {
			'claude-opus-5': {
				cacheCreationInputTokens: 5,
				cacheReadInputTokens: 4_200_000,
				contextWindow: 200_000,
				inputTokens: 1_000,
				outputTokens: 395,
			},
		},
		subtype: 'success',
		type: 'result',
	});

	assert.deepEqual(usageSnapshots(events), [
		{ contextWindow: 200_000, percent: 0.75, tokens: 1_500 },
	]);
	assert.deepEqual(
		events.filter((event) => event.type === 'status'),
		[
			{
				at: NOW.toISOString(),
				previous: 'streaming',
				status: 'idle',
				type: 'status',
			},
		],
	);
});

test('each response restates occupancy rather than adding to the last one', () => {
	const { normalize } = createNormalizer();
	normalize(initMessage());
	normalize({
		modelUsage: { 'claude-opus-5': { contextWindow: 200_000 } },
		subtype: 'success',
		type: 'result',
	});

	const first = normalize(
		assistantMessage({ cache_read_input_tokens: 20_000, output_tokens: 500 }),
	);
	const second = normalize(
		assistantMessage({ cache_read_input_tokens: 25_000, output_tokens: 400 }),
	);

	assert.deepEqual(usageSnapshots(first), [
		{ contextWindow: 200_000, percent: 10.25, tokens: 20_500 },
	]);
	assert.deepEqual(usageSnapshots(second), [
		{ contextWindow: 200_000, percent: 12.7, tokens: 25_400 },
	]);
});

test('a subagent response leaves the main thread occupancy alone', () => {
	const { normalize } = createNormalizer();
	normalize(initMessage());
	normalize({
		modelUsage: { 'claude-opus-5': { contextWindow: 200_000 } },
		subtype: 'success',
		type: 'result',
	});

	const main = normalize(
		assistantMessage({ input_tokens: 30_000, output_tokens: 1_000 }),
	);
	const subagent = normalize(
		assistantMessage(
			{ input_tokens: 900, output_tokens: 100 },
			{ parent_tool_use_id: 'toolu_1' },
		),
	);

	assert.deepEqual(usageSnapshots(main), [
		{ contextWindow: 200_000, percent: 15.5, tokens: 31_000 },
	]);
	assert.deepEqual(usageSnapshots(subagent), []);
});

test('nothing is reported until the runtime has named a context window', () => {
	const { normalize } = createNormalizer();
	normalize(initMessage());

	const beforeWindow = normalize(
		assistantMessage({ cache_read_input_tokens: 120_000, output_tokens: 500 }),
	);
	const atResult = normalize({
		modelUsage: { 'claude-opus-5': { contextWindow: 200_000 } },
		subtype: 'success',
		type: 'result',
	});

	assert.deepEqual(usageSnapshots(beforeWindow), []);
	assert.deepEqual(usageSnapshots(atResult), [
		{ contextWindow: 200_000, percent: 60.25, tokens: 120_500 },
	]);
});

test('the window comes from the main model, not a wider subagent model', () => {
	const { normalize } = createNormalizer();
	normalize(initMessage());
	normalize(assistantMessage({ input_tokens: 100_000 }));

	const events = normalize({
		modelUsage: {
			'claude-opus-5': { contextWindow: 200_000 },
			'claude-opus-5[1m]': { contextWindow: 1_000_000 },
		},
		subtype: 'success',
		type: 'result',
	});

	assert.deepEqual(usageSnapshots(events), [
		{ contextWindow: 200_000, percent: 50, tokens: 100_000 },
	]);
});

test('an unmatched main model falls back to the widest reported window', () => {
	const { normalize } = createNormalizer();
	normalize(initMessage({ model: 'opusplan' }));
	normalize(assistantMessage({ input_tokens: 100_000 }));

	const events = normalize({
		modelUsage: { 'claude-opus-5': { contextWindow: 200_000 } },
		subtype: 'success',
		type: 'result',
	});

	assert.deepEqual(usageSnapshots(events), [
		{ contextWindow: 200_000, percent: 50, tokens: 100_000 },
	]);
});

test('a mid-session model switch moves the window with the main thread', () => {
	const { normalize } = createNormalizer();
	normalize(initMessage());
	normalize({
		message: {
			content: [{ text: 'done', type: 'text' }],
			model: 'claude-sonnet-5',
			usage: { input_tokens: 100_000 },
		},
		parent_tool_use_id: null,
		type: 'assistant',
	});

	const events = normalize({
		modelUsage: {
			'claude-opus-5': { contextWindow: 1_000_000 },
			'claude-sonnet-5': { contextWindow: 200_000 },
		},
		subtype: 'success',
		type: 'result',
	});

	assert.deepEqual(usageSnapshots(events), [
		{ contextWindow: 200_000, percent: 50, tokens: 100_000 },
	]);
});

test('an unchanged snapshot is not re-emitted at the end of the turn', () => {
	const { normalize } = createNormalizer();
	normalize(initMessage());
	normalize({
		modelUsage: { 'claude-opus-5': { contextWindow: 200_000 } },
		subtype: 'success',
		type: 'result',
	});
	normalize(assistantMessage({ input_tokens: 10_000, output_tokens: 200 }));

	const events = normalize({
		modelUsage: { 'claude-opus-5': { contextWindow: 200_000 } },
		subtype: 'success',
		type: 'result',
	});

	assert.deepEqual(usageSnapshots(events), []);
});

test('a response reporting no usage leaves the gauge unreported', () => {
	const { normalize } = createNormalizer();
	normalize(initMessage());
	normalize({
		modelUsage: { 'claude-opus-5': { contextWindow: 200_000 } },
		subtype: 'success',
		type: 'result',
	});

	const events = normalize(assistantMessage(null));

	assert.deepEqual(usageSnapshots(events), []);
});

test('a failed result also surfaces a recoverable error event', () => {
	const { normalize } = createNormalizer();
	normalize(initMessage());

	const events = normalize({
		errors: ['tool crashed'],
		modelUsage: {},
		subtype: 'error_during_execution',
		type: 'result',
	});

	assert.deepEqual(events, [
		{
			at: NOW.toISOString(),
			error: {
				code: 'adapter-failure',
				detail: 'tool crashed',
				message: 'Claude ended the turn: error_during_execution.',
				recoverable: true,
			},
			type: 'error',
		},
	]);
});

test('a compaction boundary reports usage against the last known window', () => {
	const { normalize } = createNormalizer();
	normalize(initMessage());
	normalize(assistantMessage({ input_tokens: 150_000 }));
	normalize({
		modelUsage: { 'claude-opus-5': { contextWindow: 200_000 } },
		subtype: 'success',
		type: 'result',
	});

	const events = normalize({
		compact_metadata: {
			post_tokens: 20_000,
			pre_tokens: 150_000,
			trigger: 'auto',
		},
		subtype: 'compact_boundary',
		type: 'system',
	});

	assert.deepEqual(events, [
		{
			at: NOW.toISOString(),
			type: 'context-usage',
			usage: { contextWindow: 200_000, percent: 10, tokens: 20_000 },
		},
	]);
});

test('SDK message types Ensemblr does not model are dropped, not forwarded as unknown', () => {
	const { normalize } = createNormalizer();
	normalize(initMessage());

	assert.deepEqual(normalize({ type: 'rate_limit_event' }), []);
	assert.deepEqual(normalize({ subtype: 'status', type: 'system' }), []);
	assert.deepEqual(normalize({ type: 'tool_use_summary' }), []);
});

test('settleTurn returns an aborted turn to idle', () => {
	const normalizer = createSdkMessageNormalizer({ now: () => NOW });
	normalizer.normalize(initMessage() as SDKMessage);
	normalizer.normalize({
		message: { content: [{ text: 'working', type: 'text' }] },
		parent_tool_use_id: null,
		type: 'assistant',
	} as SDKMessage);

	assert.deepEqual(normalizer.settleTurn(), [
		{
			at: NOW.toISOString(),
			previous: 'streaming',
			status: 'idle',
			type: 'status',
		},
	]);
});

test('the native ExitPlanMode call is lifted into a plan submission', () => {
	const { normalize } = createNormalizer();
	normalize(initMessage());

	const events = normalize({
		message: {
			content: [
				{
					id: 'toolu_9',
					input: { plan: '# Ship it\n\nStep one.' },
					name: 'ExitPlanMode',
					type: 'tool_use',
				},
			],
		},
		parent_tool_use_id: null,
		type: 'assistant',
	});

	const submissions = events.flatMap((event) => {
		const submission = detectPlanSubmission(event);
		return submission ? [submission] : [];
	});
	assert.deepEqual(submissions, [
		{ plan: '# Ship it\n\nStep one.', title: 'Ship it', toolCallId: 'toolu_9' },
	]);
});

test('a non-plan tool call is not mistaken for a plan submission', () => {
	const { normalize } = createNormalizer();
	normalize(initMessage());

	const events = normalize({
		message: {
			content: [
				{
					id: 'toolu_3',
					input: { path: 'a.ts' },
					name: 'Read',
					type: 'tool_use',
				},
			],
		},
		parent_tool_use_id: null,
		type: 'assistant',
	});

	assert.equal(
		events.every((event) => detectPlanSubmission(event) === null),
		true,
	);
});
