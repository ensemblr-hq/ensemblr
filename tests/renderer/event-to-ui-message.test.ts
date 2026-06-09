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

describe('eventsToUIMessages', () => {
	test('maps a user prompt envelope to a UIMessage with a text part', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-1',
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
		expect(messages[0]?.id).toBe('pi-turn:turn-1:user:evt-1');
		expect(messages[0]?.parts).toEqual([
			{ state: 'done', text: 'Hello Pi', type: 'text' },
		]);
	});

	test('maps an assistant text envelope to an assistant UIMessage', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-2',
				payload: {
					kind: 'message',
					payload: { kind: 'text', text: 'Hi there' },
					role: 'agent',
				},
				turnId: 'turn-2',
			}),
		]);

		expect(messages).toHaveLength(1);
		expect(messages[0]?.role).toBe('assistant');
		expect(messages[0]?.parts).toEqual([
			{ state: 'done', text: 'Hi there', type: 'text' },
		]);
	});

	test('maps a composite message payload into reasoning + text parts', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-3',
				payload: {
					kind: 'message',
					payload: {
						kind: 'message',
						parts: [
							{ kind: 'reasoning', text: 'Let me think' },
							{ kind: 'text', text: 'Reasoned answer' },
						],
						role: 'assistant',
					},
					role: 'agent',
				},
				turnId: 'turn-3',
			}),
		]);

		expect(messages).toHaveLength(1);
		expect(messages[0]?.role).toBe('assistant');
		expect(messages[0]?.parts).toEqual([
			{ state: 'done', text: 'Let me think', type: 'reasoning' },
			{ state: 'done', text: 'Reasoned answer', type: 'text' },
		]);
	});

	test('maps composite message parts including tool-call into UI parts', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-content',
				payload: {
					kind: 'message',
					payload: {
						kind: 'message',
						parts: [
							{ kind: 'reasoning', text: 'Plan first' },
							{ kind: 'text', text: 'Then answer' },
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
				turnId: 'turn-content',
			}),
		]);

		expect(messages[0]?.parts).toEqual([
			{ state: 'done', text: 'Plan first', type: 'reasoning' },
			{ state: 'done', text: 'Then answer', type: 'text' },
			{
				input: { command: 'pwd' },
				state: 'input-available',
				toolCallId: 'call-1',
				toolName: 'bash',
				type: 'dynamic-tool',
			},
		]);
	});

	test('maps a tool-result envelope to a dynamic-tool output-available part', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-4',
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
				turnId: 'turn-4',
			}),
		]);

		expect(messages).toHaveLength(1);
		expect(messages[0]?.role).toBe('assistant');
		expect(messages[0]?.parts).toEqual([
			{
				input: {},
				output: 'README.md',
				state: 'output-available',
				toolCallId: 'call-ls',
				toolName: 'tool',
				type: 'dynamic-tool',
			},
		]);
	});

	test('maps a tool-call envelope to an input-available dynamic-tool part', () => {
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
				turnId: 'turn-tool-call',
			}),
		]);

		expect(messages[0]?.parts).toEqual([
			{
				input: { command: 'ls' },
				state: 'input-available',
				toolCallId: 'call-ls',
				toolName: 'bash',
				type: 'dynamic-tool',
			},
		]);
	});

	test('emits a system message for error events', () => {
		const messages = eventsToUIMessages([
			event({
				eventType: 'error',
				id: 'evt-5',
				payload: {
					error: {
						detail: 'stack trace here',
						message: 'Boom',
						recoverable: false,
					},
					kind: 'error',
				},
			}),
		]);

		expect(messages).toHaveLength(1);
		expect(messages[0]?.role).toBe('system');
		expect(messages[0]?.id).toBe('pi-event:evt-5');
		const part = messages[0]?.parts[0];
		expect(part?.type).toBe('text');
		if (part?.type === 'text') {
			expect(part.text).toContain('[fatal] Boom');
			expect(part.text).toContain('stack trace here');
		}
	});

	test('emits a system message for stderr events', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-6',
				payload: {
					error: { detail: 'ENOENT thing.txt', message: 'Pi RPC stderr' },
					kind: 'error',
				},
				stream: 'stderr',
			}),
		]);

		expect(messages).toHaveLength(1);
		expect(messages[0]?.role).toBe('system');
		const part = messages[0]?.parts[0];
		expect(part?.type).toBe('text');
		if (part?.type === 'text') {
			expect(part.text).toContain('[stderr]');
			expect(part.text).toContain('ENOENT thing.txt');
		}
	});

	test('groups consecutive assistant events sharing a turnId into a single message', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-7a',
				payload: {
					kind: 'message',
					payload: { kind: 'text', text: 'Part one.' },
					role: 'agent',
				},
				turnId: 'turn-7',
			}),
			event({
				id: 'evt-7b',
				payload: {
					kind: 'message',
					payload: { kind: 'text', text: 'Part two.' },
					role: 'agent',
				},
				turnId: 'turn-7',
			}),
		]);

		expect(messages).toHaveLength(1);
		expect(messages[0]?.parts).toEqual([
			{ state: 'done', text: 'Part one.', type: 'text' },
			{ state: 'done', text: 'Part two.', type: 'text' },
		]);
	});

	test('splits the group when a non-message event interrupts the turn', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-8a',
				payload: {
					kind: 'message',
					payload: { kind: 'text', text: 'Before status' },
					role: 'agent',
				},
				turnId: 'turn-8',
			}),
			event({
				eventType: 'status',
				id: 'evt-8b',
				payload: { kind: 'status', previous: 'idle', status: 'streaming' },
				turnId: 'turn-8',
			}),
			event({
				id: 'evt-8c',
				payload: {
					kind: 'message',
					payload: { kind: 'text', text: 'After status' },
					role: 'agent',
				},
				turnId: 'turn-8',
			}),
		]);

		expect(messages).toHaveLength(3);
		expect(messages[0]?.role).toBe('assistant');
		expect(messages[1]?.role).toBe('system');
		expect(messages[2]?.role).toBe('assistant');
	});

	test('splits the group when the role changes mid-turn', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-9a',
				payload: {
					kind: 'message',
					payload: { kind: 'prompt', prompt: 'Run the linter' },
					role: 'user',
				},
				turnId: 'turn-9',
			}),
			event({
				id: 'evt-9b',
				payload: {
					kind: 'message',
					payload: { kind: 'text', text: 'Running' },
					role: 'agent',
				},
				turnId: 'turn-9',
			}),
		]);

		expect(messages).toHaveLength(2);
		expect(messages[0]?.role).toBe('user');
		expect(messages[1]?.role).toBe('assistant');
	});

	test('describes metadata, shutdown, and unknown events as system messages', () => {
		const messages = eventsToUIMessages([
			event({
				eventType: 'metadata',
				id: 'evt-10a',
				payload: {
					kind: 'metadata',
					metadata: { sessionId: 'pi-sess-123' },
				},
			}),
			event({
				eventType: 'shutdown',
				id: 'evt-10b',
				payload: { kind: 'shutdown', reason: 'manual' },
			}),
			event({ eventType: 'weird', id: 'evt-10c', payload: null }),
		]);

		expect(messages.map((m) => m.role)).toEqual(['system', 'system', 'system']);
		const texts = messages.map((m) =>
			m.parts[0]?.type === 'text' ? m.parts[0].text : '',
		);
		expect(texts[0]).toContain('pi-sess-123');
		expect(texts[1]).toContain('Session ended');
		expect(texts[2]).toContain('weird');
	});
});
