import type { UIMessage } from 'ai';
import { describe, expect, test } from 'vitest';

import {
	eventsToUIMessages,
	failureMetadataOf,
	noticeMetadataOf,
	turnMetadataOf,
} from '../../src/renderer/lib/agent-timeline/event-to-ui-message';
import { parentToolCallIdOf } from '../../src/renderer/lib/agent-timeline/subagent-parts';
import type {
	AgentPersistedEnvelope,
	AgentSessionEventWire,
} from '../../src/shared/ipc';

function event(
	overrides: Partial<AgentSessionEventWire> & {
		payload?: AgentPersistedEnvelope | null;
	},
): AgentSessionEventWire {
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

	test('keeps a redacted reasoning payload so the turn still shows it thought', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-agent-redacted-reasoning',
				payload: {
					kind: 'message',
					payload: { kind: 'reasoning', text: '' },
					role: 'agent',
				},
				turnId: 'turn-redacted-reasoning',
			}),
		]);

		expect(messages[0]?.parts).toEqual([
			{ state: 'done', text: '', type: 'reasoning' },
		]);
	});

	test('keeps a redacted reasoning part inside a composite message', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-agent-redacted-part',
				payload: {
					kind: 'message',
					payload: {
						kind: 'message',
						parts: [
							{ kind: 'reasoning', text: '' },
							{ kind: 'text', text: 'Hi there' },
						],
						role: 'assistant',
					},
					role: 'agent',
				},
				turnId: 'turn-redacted-part',
			}),
		]);

		expect(messages[0]?.parts).toEqual([
			{ state: 'done', text: '', type: 'reasoning' },
			{ state: 'done', text: 'Hi there', type: 'text' },
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
				output: { details: null, text: 'README.md' },
				state: 'output-available',
				toolCallId: 'call-ls',
				toolName: 'bash',
				type: 'dynamic-tool',
			},
		]);
	});

	test('carries the tool details bag alongside the flattened text', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-edit-result',
				payload: {
					kind: 'message',
					payload: {
						isError: false,
						kind: 'tool-result',
						output: {
							content: [{ text: 'Replaced 1 block.', type: 'text' }],
							details: { firstChangedLine: 3, patch: '--- a\n+++ b\n' },
						},
						toolCallId: 'call-edit',
					},
					role: 'tool',
				},
				turnId: 'turn-edit',
			}),
		]);

		expect(messages[0]?.parts[0]).toMatchObject({
			output: {
				details: { firstChangedLine: 3, patch: '--- a\n+++ b\n' },
				text: 'Replaced 1 block.',
			},
		});
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
				errorText: '{\n  "message": "Command failed"\n}',
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

	test('surfaces fatal errors as system diagnostics without a severity tag', () => {
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
		]);

		expect(messages).toHaveLength(1);
		expect(messages[0]?.role).toBe('system');
		expect(messageText(messages)).toContain('Boom');
		expect(messageText(messages)).toContain('stack trace here');
		expect(messageText(messages)).not.toContain('[fatal]');
	});

	test('carries the whole failure on the diagnostic so the row can key off it', () => {
		const messages = eventsToUIMessages([
			event({
				eventType: 'error',
				id: 'evt-error',
				payload: {
					error: {
						code: 'adapter-failure',
						failureClass: 'provider-truncated',
						message: 'API Error: Server error mid-response.',
						recoverable: false,
					},
					kind: 'error',
				},
			}),
		]);

		expect(failureMetadataOf(messages[0] as UIMessage)?.failure).toMatchObject({
			code: 'adapter-failure',
			failureClass: 'provider-truncated',
		});
	});

	// A truncated answer that still renders as a finished one is half the bug:
	// the reader cannot tell the agent stopped from the agent being done.
	test('marks the assistant turn a fatal failure cut short as incomplete', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-answer',
				payload: {
					kind: 'message',
					payload: { kind: 'text', text: 'The migration touches four call' },
					role: 'agent',
				},
				turnId: 'turn-1',
			}),
			event({
				eventType: 'error',
				id: 'evt-error',
				ordinal: 1,
				payload: {
					error: { message: 'Boom', recoverable: false },
					kind: 'error',
				},
			}),
		]);

		expect(messages[0]?.role).toBe('assistant');
		expect(turnMetadataOf(messages[0] as UIMessage)?.incomplete).toBe(true);
	});

	// Claude Code streams its plan-limit banner as an ordinary answer before the
	// adapter lifts it onto the failure path, and no seal ever supersedes those
	// deltas — so without this the same sentence renders twice.
	test('drops streamed text the failure row is about to restate', () => {
		const banner = "You've hit your session limit · resets 5pm (Asia/Nicosia)";
		const messages = eventsToUIMessages([
			event({
				id: 'delta:session-1:0:1',
				ordinal: 1.000001,
				payload: {
					kind: 'message',
					payload: { kind: 'text-delta', text: banner },
					role: 'agent',
				},
				turnId: 'turn-1',
			}),
			event({
				eventType: 'error',
				id: 'evt-error',
				ordinal: 2,
				payload: {
					error: {
						failureClass: 'rate-limit',
						message: banner,
						recoverable: false,
					},
					kind: 'error',
				},
			}),
		]);

		expect(messages).toHaveLength(1);
		expect(messages[0]?.role).toBe('system');
	});

	test('keeps streamed text a failure row does not restate', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'delta:session-1:0:1',
				ordinal: 1.000001,
				payload: {
					kind: 'message',
					payload: {
						kind: 'text-delta',
						text: 'The migration touches four call',
					},
					role: 'agent',
				},
				turnId: 'turn-1',
			}),
			event({
				eventType: 'error',
				id: 'evt-error',
				ordinal: 2,
				payload: {
					error: { message: 'Boom', recoverable: false },
					kind: 'error',
				},
			}),
		]);

		expect(messages.map((message) => message.role)).toEqual([
			'assistant',
			'system',
		]);
		expect(messageText(messages)).toContain('The migration touches four call');
	});

	test('leaves a turn alone when the failure did not interrupt one', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-user',
				payload: {
					kind: 'message',
					payload: { kind: 'prompt', prompt: 'Hello' },
					role: 'user',
				},
				turnId: 'turn-1',
			}),
			event({
				eventType: 'error',
				id: 'evt-error',
				ordinal: 1,
				payload: {
					error: { message: 'Boom', recoverable: false },
					kind: 'error',
				},
			}),
		]);

		expect(
			turnMetadataOf(messages[0] as UIMessage)?.incomplete,
		).toBeUndefined();
	});

	test('drops stderr rows and recoverable errors as non-fatal noise', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-stderr',
				payload: {
					error: { detail: 'ENOENT thing.txt', message: 'Pi RPC stderr' },
					kind: 'error',
				},
				stream: 'stderr',
			}),
			event({
				eventType: 'error',
				id: 'evt-recoverable',
				payload: {
					error: { message: 'Pi RPC command failed.', recoverable: true },
					kind: 'error',
				},
			}),
		]);

		expect(messages).toEqual([]);
	});

	test('drops graceful process exits persisted before the adapter stopped reporting them', () => {
		const messages = eventsToUIMessages([
			event({
				eventType: 'error',
				id: 'evt-sigterm',
				payload: {
					error: {
						message: 'Pi RPC process exited with code 143.',
						recoverable: false,
					},
					kind: 'error',
				},
			}),
			event({
				eventType: 'error',
				id: 'evt-oom',
				payload: {
					error: {
						message: 'Pi RPC process exited with code 137.',
						recoverable: false,
					},
					kind: 'error',
				},
			}),
		]);

		expect(messages).toHaveLength(1);
		expect(messageText(messages)).toContain('exited with code 137');
	});

	test('marks an aborted shutdown as an interruption notice after the turn', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-answer',
				payload: {
					kind: 'message',
					payload: { kind: 'text', text: 'Working on it' },
					role: 'agent',
				},
			}),
			event({
				eventType: 'shutdown',
				id: 'evt-stop',
				payload: { kind: 'shutdown', reason: 'aborted' },
			}),
		]);

		expect(messages).toHaveLength(2);
		expect(messages[0]?.role).toBe('assistant');
		expect(messages[1]?.role).toBe('system');
		expect(noticeMetadataOf(messages[1] as UIMessage)).toEqual({
			notice: 'interrupted',
		});
		expect(messageText([messages[1] as UIMessage])).toContain(
			'You stopped this turn',
		);
	});

	test('keeps an extension-injected message off the text path', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-custom',
				payload: {
					kind: 'message',
					payload: {
						customType: 'context7_docs',
						display: false,
						kind: 'custom',
						text: '[Context7 Docs: tailwind]\n# Usage',
					},
					role: 'agent',
				},
				turnId: 'turn-1',
			}),
			event({
				id: 'evt-answer',
				ordinal: 1,
				payload: {
					kind: 'message',
					payload: { kind: 'text', text: 'Converted the app.' },
					role: 'agent',
				},
				turnId: 'turn-1',
			}),
		]);

		expect(messages).toHaveLength(1);
		expect(messages[0]?.parts).toEqual([
			{
				data: {
					customType: 'context7_docs',
					display: false,
					text: '[Context7 Docs: tailwind]\n# Usage',
				},
				type: 'data-pi-custom',
			},
			{ state: 'done', text: 'Converted the app.', type: 'text' },
		]);
		expect(messageText(messages)).not.toContain('Context7 Docs');
	});

	test('drops an injected message that carried no content', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-empty-custom',
				payload: {
					kind: 'message',
					payload: {
						customType: 'context7_docs',
						display: true,
						kind: 'custom',
						text: '',
					},
					role: 'agent',
				},
			}),
		]);

		expect(messages).toEqual([]);
	});

	test('rewrites a skill prompt to its command and marks the turn activated', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-skill',
				payload: {
					kind: 'message',
					payload: {
						kind: 'prompt',
						prompt: [
							'<skill name="caveman" location="/skills/caveman/SKILL.md">',
							'Respond terse like smart caveman.',
							'</skill>',
							'',
							'summarize the diff',
						].join('\n'),
					},
					role: 'user',
				},
				turnId: 'turn-1',
			}),
			event({
				id: 'evt-answer',
				ordinal: 1,
				payload: {
					kind: 'message',
					payload: { kind: 'text', text: 'Ready. What task?' },
					role: 'agent',
				},
				turnId: 'turn-1',
			}),
		]);

		expect(messages).toHaveLength(2);
		expect(messages[0]?.role).toBe('user');
		expect(messages[0]?.parts).toEqual([
			{
				state: 'done',
				text: '/skill:caveman summarize the diff',
				type: 'text',
			},
		]);
		expect(messages[1]?.role).toBe('assistant');
		expect(messages[1]?.parts).toEqual([
			{ data: { name: 'caveman' }, type: 'data-pi-skill' },
			{ state: 'done', text: 'Ready. What task?', type: 'text' },
		]);
		expect(messageText(messages)).not.toContain('Respond terse');
	});

	test('rewrites a bodyless skill invocation to a bare command', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-skill-noargs',
				payload: {
					kind: 'message',
					payload: {
						kind: 'prompt',
						prompt: [
							'<skill name="caveman" location="/skills/caveman/SKILL.md">',
							'Respond terse.',
							'</skill>',
						].join('\n'),
					},
					role: 'user',
				},
				turnId: 'turn-2',
			}),
		]);

		expect(messages).toHaveLength(1);
		expect(messages[0]?.parts).toEqual([
			{ state: 'done', text: '/skill:caveman', type: 'text' },
		]);
	});

	test('drops the raw skill prompt the adapter flushes after its echo', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-skill',
				payload: {
					kind: 'message',
					payload: {
						kind: 'prompt',
						prompt: [
							'<skill name="caveman" location="/skills/caveman/SKILL.md">',
							'Respond terse.',
							'</skill>',
							'',
							'write me a poem',
						].join('\n'),
					},
					role: 'user',
				},
				turnId: 'turn-1',
			}),
			event({
				id: 'evt-answer',
				ordinal: 1,
				payload: {
					kind: 'message',
					payload: { kind: 'text', text: 'Me poem' },
					role: 'agent',
				},
				turnId: 'turn-1',
			}),
			event({
				id: 'evt-flush',
				ordinal: 2,
				payload: {
					kind: 'message',
					payload: { kind: 'prompt', prompt: '/skill:caveman write me a poem' },
					role: 'user',
				},
				turnId: 'turn-1',
			}),
		]);

		expect(messages).toHaveLength(2);
		expect(messages[0]?.role).toBe('user');
		expect(messages[0]?.parts).toEqual([
			{ state: 'done', text: '/skill:caveman write me a poem', type: 'text' },
		]);
		expect(messages[1]?.role).toBe('assistant');
		expect(messages[1]?.parts).toEqual([
			{ data: { name: 'caveman' }, type: 'data-pi-skill' },
			{ state: 'done', text: 'Me poem', type: 'text' },
		]);
	});

	test('keeps a re-invoked skill prompt whose own turn was interrupted', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-skill',
				payload: {
					kind: 'message',
					payload: {
						kind: 'prompt',
						prompt: [
							'<skill name="caveman" location="/skills/caveman/SKILL.md">',
							'Respond terse.',
							'</skill>',
							'',
							'write me a poem',
						].join('\n'),
					},
					role: 'user',
				},
				turnId: 'turn-1',
			}),
			event({
				id: 'evt-answer',
				ordinal: 1,
				payload: {
					kind: 'message',
					payload: { kind: 'text', text: 'Me poem' },
					role: 'agent',
				},
				turnId: 'turn-1',
			}),
			event({
				id: 'evt-reinvoke',
				ordinal: 2,
				payload: {
					kind: 'message',
					payload: { kind: 'prompt', prompt: '/skill:caveman write me a poem' },
					role: 'user',
				},
				turnId: 'turn-2',
			}),
		]);

		const prompts = messages
			.filter((message) => message.role === 'user')
			.map((message) =>
				message.parts
					.flatMap((part) =>
						part.type === 'text' && part.text ? [part.text] : [],
					)
					.join('\n'),
			);

		expect(prompts).toEqual([
			'/skill:caveman write me a poem',
			'/skill:caveman write me a poem',
		]);
	});

	test('keeps the activation marker when the turn errors before replying', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-skill',
				payload: {
					kind: 'message',
					payload: {
						kind: 'prompt',
						prompt: [
							'<skill name="caveman" location="/skills/caveman/SKILL.md">',
							'Respond terse.',
							'</skill>',
							'',
							'write me a poem',
						].join('\n'),
					},
					role: 'user',
				},
				turnId: 'turn-1',
			}),
			event({
				eventType: 'error',
				id: 'evt-error',
				ordinal: 1,
				payload: {
					error: { message: 'provider exploded', recoverable: false },
					kind: 'error',
				},
				turnId: 'turn-1',
			}),
		]);

		const skillParts = messages.flatMap((message) =>
			message.parts.filter((part) => part.type === 'data-pi-skill'),
		);

		expect(skillParts).toEqual([
			{ data: { name: 'caveman' }, type: 'data-pi-skill' },
		]);
	});

	test('keeps a lone raw skill prompt with no echo to reconcile against', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-flush-only',
				payload: {
					kind: 'message',
					payload: { kind: 'prompt', prompt: '/skill:caveman write me a poem' },
					role: 'user',
				},
				turnId: 'turn-1',
			}),
		]);

		expect(messages).toHaveLength(1);
		expect(messages[0]?.parts).toEqual([
			{ state: 'done', text: '/skill:caveman write me a poem', type: 'text' },
		]);
	});

	test('leaves completed, crashed, and manual shutdowns unrendered', () => {
		for (const reason of ['completed', 'crashed', 'manual']) {
			const messages = eventsToUIMessages([
				event({
					eventType: 'shutdown',
					id: `evt-${reason}`,
					payload: { kind: 'shutdown', reason },
				}),
			]);

			expect(messages, `reason=${reason}`).toEqual([]);
		}
	});
});

describe('subagent attribution', () => {
	test('stamps the owning tool call onto a subagent tool call', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-call',
				payload: {
					kind: 'message',
					parentToolCallId: 'task-1',
					payload: {
						input: { pattern: 'foo' },
						kind: 'tool-call',
						name: 'Grep',
						toolCallId: 'call-1',
					},
					role: 'tool',
				},
			}),
		]);

		expect(parentToolCallIdOf(messages[0]?.parts[0] as never)).toBe('task-1');
	});

	test('keeps the link when the result outranks the call it settles', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-call',
				ordinal: 0,
				payload: {
					kind: 'message',
					parentToolCallId: 'task-1',
					payload: {
						input: { pattern: 'foo' },
						kind: 'tool-call',
						name: 'Grep',
						toolCallId: 'call-1',
					},
					role: 'tool',
				},
			}),
			event({
				id: 'evt-result',
				ordinal: 1,
				payload: {
					kind: 'message',
					parentToolCallId: 'task-1',
					payload: {
						isError: false,
						kind: 'tool-result',
						output: { content: [{ text: 'match', type: 'text' }] },
						toolCallId: 'call-1',
					},
					role: 'tool',
				},
			}),
		]);

		const parts = messages.flatMap((message) => message.parts);
		expect(parts).toHaveLength(1);
		expect(parts[0]?.type === 'dynamic-tool' && parts[0].state).toBe(
			'output-available',
		);
		expect(parentToolCallIdOf(parts[0] as never)).toBe('task-1');
	});

	test('does not concatenate a subagent delta into the main thread buffer', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-main',
				ordinal: 0,
				payload: {
					kind: 'message',
					payload: { kind: 'text-delta', text: 'main ' },
					role: 'agent',
				},
			}),
			event({
				id: 'evt-sub',
				ordinal: 1,
				payload: {
					kind: 'message',
					parentToolCallId: 'task-1',
					payload: { kind: 'text-delta', text: 'delegate' },
					role: 'agent',
				},
			}),
		]);

		const parts = messages.flatMap((message) => message.parts);
		expect(parts).toHaveLength(2);
		expect(
			parts.map((part) => (part.type === 'text' ? part.text : '')),
		).toEqual(['main ', 'delegate']);
	});

	test('does not let a subagent seal drop the main thread streaming text', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-main',
				ordinal: 0,
				payload: {
					kind: 'message',
					payload: { kind: 'text-delta', text: 'still writing' },
					role: 'agent',
				},
			}),
			event({
				id: 'evt-sub',
				ordinal: 1,
				payload: {
					kind: 'message',
					parentToolCallId: 'task-1',
					payload: { kind: 'text', text: 'delegate report' },
					role: 'agent',
				},
			}),
		]);

		const texts = messages
			.flatMap((message) => message.parts)
			.flatMap((part) => (part.type === 'text' ? [part.text] : []));
		expect(texts).toEqual(['still writing', 'delegate report']);
	});

	test('leaves rows without a link unowned, as Pi and pre-existing rows are', () => {
		const messages = eventsToUIMessages([
			event({
				id: 'evt-call',
				payload: {
					kind: 'message',
					payload: {
						input: {},
						kind: 'tool-call',
						name: 'Grep',
						toolCallId: 'call-1',
					},
					role: 'tool',
				},
			}),
		]);

		expect(parentToolCallIdOf(messages[0]?.parts[0] as never)).toBeNull();
	});
});
