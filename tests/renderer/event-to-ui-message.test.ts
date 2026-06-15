/// <reference types="bun" />

import { describe, expect, test } from 'bun:test';

import { eventsToUIMessages } from '../../src/renderer/lib/pi/event-to-ui-message';
import type {
	PiPersistedEnvelope,
	PiSessionEventWire,
} from '../../src/shared/ipc';

function event(
	overrides: Partial<PiSessionEventWire> & {
		payload?: PiPersistedEnvelope | null;
	},
): PiSessionEventWire {
	return {
		branchId: 'branch-1',
		createdAt: '2026-06-08T12:00:00.000Z',
		eventType: 'message',
		id: 'evt-default',
		ordinal: 0,
		payload: null,
		stream: 'protocol',
		turnId: null,
		...overrides,
	};
}

function messageText(
	eventMessages: ReturnType<typeof eventsToUIMessages>,
): string {
	return eventMessages
		.flatMap((message) => message.parts)
		.map((part) => (part.type === 'text' ? part.text : ''))
		.join('\n');
}

describe('eventsToUIMessages', () => {
	test('maps a user prompt event to a single text part with user role', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-user',
				payload: {
					kind: 'message',
					payload: { kind: 'prompt', prompt: 'Hello Pi' },
					role: 'user',
				},
				turnId: 'turn-1',
			}),
		]);

		expect(messages).toHaveLength(1);
		expect(messages[0]?.role).toBe('user');
		expect(messages[0]?.parts).toEqual([
			{ state: 'done', text: 'Hello Pi', type: 'text' },
		]);
	});

	test('stamps the assistant turn with the preceding prompt submit time', () => {
		const messages = eventsToUIMessages([
			event({
				createdAt: '2026-06-08T12:00:00.000Z',
				id: 'evt-user',
				payload: {
					kind: 'message',
					payload: { kind: 'prompt', prompt: 'Do the thing' },
					role: 'user',
				},
				turnId: 'turn-1',
			}),
			event({
				createdAt: '2026-06-08T12:00:07.500Z',
				id: 'evt-agent',
				ordinal: 1,
				payload: {
					kind: 'message',
					payload: { kind: 'text', text: 'Done' },
					role: 'agent',
				},
				turnId: 'turn-1',
			}),
		]);

		const assistant = messages.find((message) => message.role === 'assistant');
		const metadata = assistant?.metadata as
			| { promptAt?: string; firstEventAt: string; lastEventAt: string }
			| undefined;
		// Start = prompt submit; end = final assistant event → 7.5s span.
		expect(metadata?.promptAt).toBe('2026-06-08T12:00:00.000Z');
		expect(metadata?.lastEventAt).toBe('2026-06-08T12:00:07.500Z');
	});

	test('maps an assistant text payload to one text part', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-agent-text',
				payload: {
					kind: 'message',
					payload: { kind: 'text', text: 'Hi there' },
					role: 'agent',
				},
				turnId: 'turn-text',
			}),
		]);

		expect(messages).toHaveLength(1);
		expect(messages[0]?.role).toBe('assistant');
		expect(messages[0]?.parts).toEqual([
			{ state: 'done', text: 'Hi there', type: 'text' },
		]);
	});

	test('maps an assistant reasoning payload to one reasoning part', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-agent-reasoning',
				payload: {
					kind: 'message',
					payload: { kind: 'reasoning', text: 'Think first' },
					role: 'agent',
				},
				turnId: 'turn-reasoning',
			}),
		]);

		expect(messages).toHaveLength(1);
		expect(messages[0]?.role).toBe('assistant');
		expect(messages[0]?.parts).toEqual([
			{ state: 'done', text: 'Think first', type: 'reasoning' },
		]);
	});

	test('maps a composite assistant message into reasoning + text + tool-call parts', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-agent-composite',
				payload: {
					kind: 'message',
					payload: {
						kind: 'message',
						parts: [
							{ kind: 'reasoning', text: 'Think first' },
							{ kind: 'text', text: 'Hi there' },
							{
								input: { command: 'pwd' },
								kind: 'tool-call',
								name: 'bash',
								toolCallId: 'call-1',
							},
						],
						role: 'assistant',
					},
					role: 'agent',
				},
				turnId: 'turn-composite',
			}),
		]);

		expect(messages).toHaveLength(1);
		expect(messages[0]?.role).toBe('assistant');
		expect(messages[0]?.parts).toEqual([
			{ state: 'done', text: 'Think first', type: 'reasoning' },
			{ state: 'done', text: 'Hi there', type: 'text' },
			{
				input: { command: 'pwd' },
				state: 'input-available',
				toolCallId: 'call-1',
				toolName: 'bash',
				type: 'dynamic-tool',
			},
		]);
	});

	test('pairs tool-call and tool-result by toolCallId inside one assistant message', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-tool-call',
				payload: {
					kind: 'message',
					payload: {
						input: { command: 'ls' },
						kind: 'tool-call',
						name: 'bash',
						toolCallId: 'call-ls',
					},
					role: 'tool',
				},
				turnId: 'turn-tool',
			}),
			event({
				id: 'evt-tool-result',
				payload: {
					kind: 'message',
					payload: {
						isError: false,
						kind: 'tool-result',
						output: { content: [{ text: 'README.md', type: 'text' }] },
						toolCallId: 'call-ls',
					},
					role: 'tool',
				},
				turnId: 'turn-tool',
			}),
		]);

		expect(messages).toHaveLength(1);
		expect(messages[0]?.parts).toEqual([
			{
				input: { command: 'ls' },
				output: 'README.md',
				state: 'output-available',
				toolCallId: 'call-ls',
				toolName: 'bash',
				type: 'dynamic-tool',
			},
		]);
	});

	test('maps errored tool-result to an output-error tool part', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-tool-error',
				payload: {
					kind: 'message',
					payload: {
						isError: true,
						kind: 'tool-result',
						output: { message: 'Command failed' },
						toolCallId: 'call-fail',
					},
					role: 'tool',
				},
				turnId: 'turn-error-tool',
			}),
		]);

		expect(messages[0]?.parts).toEqual([
			{
				errorText: '{"message":"Command failed"}',
				input: {},
				state: 'output-error',
				toolCallId: 'call-fail',
				toolName: 'tool',
				type: 'dynamic-tool',
			},
		]);
	});

	test('filters metadata, status, shutdown, null, unknown, and lifecycle noise', () => {
		const messages = eventsToUIMessages([
			event({
				eventType: 'metadata',
				id: 'evt-metadata',
				payload: { kind: 'metadata', metadata: { sessionId: 'pi-sess-123' } },
			}),
			event({
				eventType: 'metadata',
				id: 'evt-title',
				payload: { kind: 'metadata', metadata: { chatTitle: 'New name' } },
			}),
			event({
				eventType: 'status',
				id: 'evt-status-start',
				payload: { kind: 'status', previous: 'idle', status: 'starting' },
			}),
			event({
				eventType: 'status',
				id: 'evt-status-streaming',
				payload: { kind: 'status', previous: 'starting', status: 'streaming' },
			}),
			event({
				eventType: 'status',
				id: 'evt-status-idle',
				payload: { kind: 'status', previous: 'streaming', status: 'idle' },
			}),
			event({
				eventType: 'shutdown',
				id: 'evt-shutdown-completed',
				payload: { kind: 'shutdown', reason: 'completed' },
			}),
			event({
				eventType: 'shutdown',
				id: 'evt-shutdown-manual',
				payload: { kind: 'shutdown', reason: 'manual' },
			}),
			event({ eventType: 'message_start', id: 'evt-null', payload: null }),
			event({
				eventType: 'agent_start',
				id: 'evt-unknown',
				payload: {
					kind: 'message',
					payload: { kind: 'unknown', frameType: 'agent_start', raw: {} },
					role: 'agent',
				},
			}),
		]);

		expect(messages).toHaveLength(0);
		expect(messageText(messages)).not.toContain(
			'Pi runtime metadata received.',
		);
		expect(messageText(messages)).not.toContain('Pi runtime session id');
		expect(messageText(messages)).not.toContain('Chat renamed');
		expect(messageText(messages)).not.toContain('Status: starting');
		expect(messageText(messages)).not.toContain('Status: streaming');
		expect(messageText(messages)).not.toContain('Status: idle');
		expect(messageText(messages)).not.toContain('Session ended');
	});

	test('groups same-turn renderable events across filtered lifecycle rows', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-before',
				payload: {
					kind: 'message',
					payload: { kind: 'text', text: 'Before status' },
					role: 'agent',
				},
				turnId: 'turn-group',
			}),
			event({
				eventType: 'status',
				id: 'evt-filtered-status',
				payload: { kind: 'status', previous: 'starting', status: 'streaming' },
				turnId: 'turn-group',
			}),
			event({
				id: 'evt-after',
				payload: {
					kind: 'message',
					payload: { kind: 'text', text: 'After status' },
					role: 'agent',
				},
				turnId: 'turn-group',
			}),
		]);

		expect(messages).toHaveLength(1);
		expect(messages[0]?.parts).toEqual([
			{ state: 'done', text: 'Before status', type: 'text' },
			{ state: 'done', text: 'After status', type: 'text' },
		]);
	});

	test('splits the group when the role changes mid-turn', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-user-role',
				payload: {
					kind: 'message',
					payload: { kind: 'prompt', prompt: 'Run the linter' },
					role: 'user',
				},
				turnId: 'turn-role',
			}),
			event({
				id: 'evt-agent-role',
				payload: {
					kind: 'message',
					payload: { kind: 'text', text: 'Running' },
					role: 'agent',
				},
				turnId: 'turn-role',
			}),
		]);

		expect(messages).toHaveLength(2);
		expect(messages[0]?.role).toBe('user');
		expect(messages[1]?.role).toBe('assistant');
	});

	test('surfaces fatal errors and actionable stderr as system diagnostics', () => {
		const messages = eventsToUIMessages([
			event({
				eventType: 'error',
				id: 'evt-error',
				payload: {
					error: {
						detail: 'stack trace here',
						message: 'Boom',
						recoverable: false,
					},
					kind: 'error',
				},
			}),
			event({
				id: 'evt-stderr',
				payload: {
					error: { detail: 'ENOENT thing.txt', message: 'Pi RPC stderr' },
					kind: 'error',
				},
				stream: 'stderr',
			}),
		]);

		expect(messages).toHaveLength(2);
		expect(messages.map((message) => message.role)).toEqual([
			'system',
			'system',
		]);
		expect(messageText(messages)).toContain('[fatal] Boom');
		expect(messageText(messages)).toContain('stack trace here');
		expect(messageText(messages)).toContain('[stderr] ENOENT thing.txt');
	});
});
