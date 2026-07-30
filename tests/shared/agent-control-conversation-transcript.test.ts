import { describe, expect, it } from 'vitest';

import { READ_CONVERSATION_LIMITS } from '../../src/shared/agent-control/contracts.ts';
import {
	buildConversationTranscript,
	type TranscriptSourceEvent,
} from '../../src/shared/agent-control/conversation-transcript.ts';
import type {
	PiPersistedEnvelope,
	PiWireMessagePart,
} from '../../src/shared/ipc/contracts/pi-message-payloads.ts';

const PI_SESSION_ID = 'session-1';

const userPrompt = (prompt: string): PiPersistedEnvelope => ({
	kind: 'message',
	payload: { kind: 'prompt', prompt },
	role: 'user',
});

const agentText = (text: string): PiPersistedEnvelope => ({
	kind: 'message',
	payload: { kind: 'text', text },
	role: 'agent',
});

const toolCall = (
	toolCallId: string,
	name: string,
	input: unknown,
): PiPersistedEnvelope => ({
	kind: 'message',
	payload: { input, kind: 'tool-call', name, toolCallId },
	role: 'tool',
});

const toolResult = (
	toolCallId: string,
	output: unknown,
	isError = false,
): PiPersistedEnvelope => ({
	kind: 'message',
	payload: { isError, kind: 'tool-result', output, toolCallId },
	role: 'tool',
});

const composite = (
	parts: readonly PiWireMessagePart[],
): PiPersistedEnvelope => ({
	kind: 'message',
	payload: { kind: 'message', parts, role: 'assistant' },
	role: 'agent',
});

const branch = (
	...payloads: readonly (PiPersistedEnvelope | null)[]
): TranscriptSourceEvent[] =>
	payloads.map((payload, index) => ({
		ordinal: index + 1,
		payload,
		stream: 'protocol' as const,
	}));

const read = (
	events: readonly TranscriptSourceEvent[],
	options: {
		fromOrdinal?: number;
		ordinal?: number;
		stat?: boolean;
	} = {},
) =>
	buildConversationTranscript({
		events,
		piSessionId: PI_SESSION_ID,
		...options,
	});

describe('buildConversationTranscript', () => {
	it('reports an empty branch as empty rather than as a gap', () => {
		const result = read([]);

		expect(result).toEqual({
			entries: [],
			entryCount: 0,
			firstOrdinal: null,
			lastOrdinal: null,
			nextOrdinal: null,
			piSessionId: PI_SESSION_ID,
			turnCount: 0,
		});
	});

	it('projects prompts and answers in the order they were written', () => {
		const result = read(
			branch(userPrompt('audit the parser'), agentText('parser looks sound')),
		);

		expect(result.entries).toEqual([
			{ kind: 'prompt', ordinal: 1, text: 'audit the parser' },
			{ kind: 'message', ordinal: 2, text: 'parser looks sound' },
		]);
		expect(result.turnCount).toBe(1);
		expect(result.firstOrdinal).toBe(1);
		expect(result.lastOrdinal).toBe(2);
		expect(result.nextOrdinal).toBeNull();
	});

	it('drops stderr rows and unparseable payloads', () => {
		const events: TranscriptSourceEvent[] = [
			{ ordinal: 1, payload: null, stream: 'protocol' },
			{ ordinal: 2, payload: agentText('noise'), stream: 'stderr' },
			{ ordinal: 3, payload: agentText('signal'), stream: 'protocol' },
		];

		expect(read(events).entries).toEqual([
			{ kind: 'message', ordinal: 3, text: 'signal' },
		]);
	});

	it('drops the frames the timeline never shows', () => {
		const result = read(
			branch(
				{
					kind: 'message',
					payload: { kind: 'reasoning', text: 'hmm' },
					role: 'agent',
				},
				{
					kind: 'message',
					payload: { kind: 'text-delta', text: 'par' },
					role: 'agent',
				},
				{ kind: 'status', previous: 'idle', status: 'streaming' },
				{
					kind: 'context-usage',
					usage: { contextWindow: 1, percent: null, tokens: null },
				},
				{ kind: 'metadata', metadata: { chatTitle: 'x' } },
				{ kind: 'shutdown', reason: 'closed' },
			),
		);

		expect(result.entries).toEqual([]);
		expect(result.entryCount).toBe(0);
	});

	it('surfaces an error frame, which is what an audit is looking for', () => {
		const result = read(
			branch({
				error: { message: 'Pi RPC crashed' },
				kind: 'error',
			}),
		);

		expect(result.entries).toEqual([
			{ kind: 'error', ordinal: 1, text: 'Pi RPC crashed' },
		]);
	});

	it('merges a streaming call and its result into one entry at the call site', () => {
		const result = read(
			branch(
				toolCall('call-1', 'bash', { command: 'npm test' }),
				agentText('running'),
				toolResult('call-1', 'ok'),
			),
		);

		expect(result.entries).toEqual([
			{
				input: '{\n  "command": "npm test"\n}',
				isError: false,
				kind: 'tool',
				name: 'bash',
				ordinal: 1,
				output: 'ok',
			},
			{ kind: 'message', ordinal: 2, text: 'running' },
		]);
	});

	it('renders a failed call as an error without losing its output', () => {
		const result = read(
			branch(
				toolCall('call-1', 'bash', {}),
				toolResult('call-1', 'command not found', true),
			),
		);

		expect(result.entries).toEqual([
			{
				input: '{}',
				isError: true,
				kind: 'tool',
				name: 'bash',
				ordinal: 1,
				output: 'command not found',
			},
		]);
	});

	it('flattens the content envelope a tool result arrives in', () => {
		const result = read(
			branch(
				toolCall('call-1', 'read', {}),
				toolResult('call-1', {
					content: [
						{ text: 'line one', type: 'text' },
						{ text: 'line two', type: 'text' },
					],
				}),
			),
		);

		expect(result.entries[0]).toMatchObject({ output: 'line one\nline two' });
	});

	it('collapses the second persistence of the same call instead of double-rendering it', () => {
		const result = read(
			branch(
				toolCall('call-1', 'bash', { command: 'npm test' }),
				toolResult('call-1', 'ok'),
				composite([
					{
						input: { command: 'npm test' },
						kind: 'tool-call',
						name: 'bash',
						toolCallId: 'call-1',
					},
					{
						isError: false,
						kind: 'tool-result',
						output: 'ok',
						toolCallId: 'call-1',
					},
					{ kind: 'text', text: 'tests pass' },
				]),
			),
		);

		expect(result.entries).toEqual([
			{
				input: '{\n  "command": "npm test"\n}',
				isError: false,
				kind: 'tool',
				name: 'bash',
				ordinal: 1,
				output: 'ok',
			},
			{ kind: 'message', ordinal: 3, text: 'tests pass' },
		]);
	});

	it('keeps the concrete tool name when only one persistence carries it', () => {
		const result = read(
			branch(
				toolCall('call-1', 'tool', {}),
				composite([
					{
						input: { path: 'a.ts' },
						kind: 'tool-call',
						name: 'read',
						toolCallId: 'call-1',
					},
				]),
			),
		);

		expect(result.entries).toEqual([
			{
				input: '{\n  "path": "a.ts"\n}',
				isError: false,
				kind: 'tool',
				name: 'read',
				ordinal: 1,
				output: '',
			},
		]);
	});

	it('keeps a result whose call was checkpointed away rather than dropping it', () => {
		const result = read(branch(toolResult('call-1', 'orphaned output')));

		expect(result.entries).toEqual([
			{
				input: '',
				isError: false,
				kind: 'tool',
				name: 'tool',
				ordinal: 1,
				output: 'orphaned output',
			},
		]);
	});

	it('counts one turn per prompt, whatever the branch produced between them', () => {
		const result = read(
			branch(
				userPrompt('first'),
				agentText('a'),
				userPrompt('second'),
				agentText('b'),
			),
		);

		expect(result.turnCount).toBe(2);
		expect(result.entryCount).toBe(4);
	});

	it('cuts an over-long field and names the call that reads it whole', () => {
		const long = 'x'.repeat(READ_CONVERSATION_LIMITS.maxFieldChars + 500);
		const result = read(branch(agentText(long)));

		const entry = result.entries[0];
		expect(entry.kind).toBe('message');
		expect(entry).toMatchObject({ ordinal: 1 });
		const text = entry.kind === 'message' ? entry.text : '';
		expect(text.length).toBeLessThanOrEqual(
			READ_CONVERSATION_LIMITS.maxFieldChars,
		);
		expect(text).toContain('ensemblr_read_conversation({ ordinal: 1 })');
	});

	it('lifts the field cap when one entry is read on its own', () => {
		const long = 'x'.repeat(READ_CONVERSATION_LIMITS.maxFieldChars + 500);
		const result = read(branch(userPrompt('go'), agentText(long)), {
			ordinal: 2,
		});

		expect(result.entries).toHaveLength(1);
		const entry = result.entries[0];
		expect(entry.kind === 'message' && entry.text).toBe(long);
		expect(result.nextOrdinal).toBeNull();
		expect(result.entryCount).toBe(2);
	});

	it('reports no entries for an ordinal the branch never produced', () => {
		const result = read(branch(agentText('a')), { ordinal: 99 });

		expect(result.entries).toEqual([]);
		expect(result.entryCount).toBe(1);
	});

	it('resumes from the cursor a caller was handed', () => {
		const result = read(
			branch(userPrompt('first'), agentText('a'), agentText('b')),
			{ fromOrdinal: 2 },
		);

		expect(result.entries.map((entry) => entry.ordinal)).toEqual([2, 3]);
		expect(result.entryCount).toBe(3);
		expect(result.firstOrdinal).toBe(1);
	});

	it('stops at the page budget and points at the entry it stopped before', () => {
		const chunk = 'x'.repeat(READ_CONVERSATION_LIMITS.maxFieldChars);
		const pageable =
			Math.ceil(
				READ_CONVERSATION_LIMITS.maxPageChars /
					READ_CONVERSATION_LIMITS.maxFieldChars,
			) + 2;
		const result = read(
			branch(...Array.from({ length: pageable }, () => agentText(chunk))),
		);

		expect(result.entries.length).toBeLessThan(pageable);
		expect(result.nextOrdinal).toBe(result.entries.length + 1);

		const rest = read(
			branch(...Array.from({ length: pageable }, () => agentText(chunk))),
			{ fromOrdinal: result.nextOrdinal ?? 0 },
		);
		expect(rest.entries[0].ordinal).toBe(result.nextOrdinal);
	});

	it('always emits one entry, so an oversized entry cannot wedge the cursor', () => {
		const huge = 'x'.repeat(READ_CONVERSATION_LIMITS.maxPageChars * 2);
		const result = read(branch(agentText(huge), agentText('next')), {
			ordinal: 1,
		});

		expect(result.entries).toHaveLength(1);
	});

	// The lifted field cap is a share of the page budget, not a licence to ignore
	// it: one ordinal can hold a whole composite turn, and capping each of its
	// fields at the page ceiling would return a multiple of the ceiling.
	it('holds a single-entry read to the page budget however many fields it spans', () => {
		const huge = 'x'.repeat(READ_CONVERSATION_LIMITS.maxPageChars);
		const result = read(
			branch(
				composite([
					{
						input: { p: huge },
						kind: 'tool-call',
						name: 'read',
						toolCallId: 'c1',
					},
					{
						isError: false,
						kind: 'tool-result',
						output: huge,
						toolCallId: 'c1',
					},
					{
						input: { p: huge },
						kind: 'tool-call',
						name: 'read',
						toolCallId: 'c2',
					},
					{
						isError: false,
						kind: 'tool-result',
						output: huge,
						toolCallId: 'c2',
					},
					{ kind: 'text', text: huge },
				]),
			),
			{ ordinal: 1 },
		);

		const chars = result.entries.reduce(
			(total, entry) =>
				total +
				(entry.kind === 'tool'
					? entry.input.length + entry.output.length
					: entry.text.length),
			0,
		);
		expect(chars).toBeLessThanOrEqual(READ_CONVERSATION_LIMITS.maxPageChars);
	});

	// An empty rendering is what a tool that returned nothing looks like, so a
	// result carrying non-text blocks has to stay distinguishable from one that
	// carried nothing at all — telling those apart is the whole point of an audit.
	it('keeps a content envelope whose blocks carry no text rather than blanking it', () => {
		const result = read(
			branch(
				toolCall('call-1', 'screenshot', {}),
				toolResult('call-1', { content: [{ source: 'b64…', type: 'image' }] }),
			),
		);

		const [entry] = result.entries;
		const output = entry.kind === 'tool' ? entry.output : '';
		expect(output).not.toBe('');
		expect(output).toContain('image');
	});

	// The merge has to survive either persistence order, and a tool whose input is
	// a bare string is still an input worth showing.
	it('keeps a non-object input when the result was persisted before the call', () => {
		const result = read(
			branch(
				toolResult('call-1', 'done'),
				composite([
					{
						input: 'ls -la /etc',
						kind: 'tool-call',
						name: 'bash',
						toolCallId: 'call-1',
					},
				]),
			),
		);

		expect(result.entries[0]).toMatchObject({
			input: 'ls -la /etc',
			name: 'bash',
			output: 'done',
		});
	});

	// A turn that narrates between its calls reads as narration-then-call, not as
	// every call followed by the narration bolted on the end.
	it('keeps text and tool calls in the order the turn wrote them', () => {
		const result = read(
			branch(
				composite([
					{ kind: 'text', text: 'checking the suite' },
					{ input: {}, kind: 'tool-call', name: 'bash', toolCallId: 'c1' },
					{ kind: 'text', text: 'now the types' },
					{ input: {}, kind: 'tool-call', name: 'bash', toolCallId: 'c2' },
				]),
			),
		);

		expect(
			result.entries.map((entry) =>
				entry.kind === 'tool' ? `tool:${entry.name}` : entry.text,
			),
		).toEqual([
			'checking the suite',
			'tool:bash',
			'now the types',
			'tool:bash',
		]);
	});

	it('answers a stat probe with counts and no content', () => {
		const result = read(
			branch(
				userPrompt('go'),
				toolCall('call-1', 'bash', {}),
				agentText('done'),
			),
			{ stat: true },
		);

		expect(result).toEqual({
			entries: [],
			entryCount: 3,
			firstOrdinal: 1,
			lastOrdinal: 3,
			nextOrdinal: null,
			piSessionId: PI_SESSION_ID,
			turnCount: 1,
		});
	});
});
