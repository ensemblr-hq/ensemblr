import { describe, expect, test } from 'vitest';

import {
	CONCIERGE_ACTIVITY_NONE,
	clearConciergeActivity,
	conciergeBadgeCount,
	isConciergeAgentMessage,
	isConciergeStreamingStatus,
	noteConciergeMessage,
	setConciergeQuestion,
} from '../../src/renderer/state/concierge/unread';
import type { AgentPersistedEnvelope } from '../../src/shared/ipc/contracts/agent-message-payloads';

function agentMessage(text: string): AgentPersistedEnvelope {
	return {
		kind: 'message',
		payload: {
			kind: 'message',
			parts: [{ kind: 'text', text }],
			role: 'assistant',
		},
		role: 'agent',
	};
}

describe('isConciergeAgentMessage', () => {
	test('counts a finished agent message carrying prose', () => {
		expect(isConciergeAgentMessage(agentMessage('Reading the board.'))).toBe(
			true,
		);
	});

	test('counts a bare text payload the wire still allows', () => {
		expect(
			isConciergeAgentMessage({
				kind: 'message',
				payload: { kind: 'text', text: 'Done.' },
				role: 'agent',
			}),
		).toBe(true);
	});

	test('ignores the deltas a streaming turn emits per token', () => {
		expect(
			isConciergeAgentMessage({
				kind: 'message',
				payload: { kind: 'text-delta', text: 'Read' },
				role: 'agent',
			}),
		).toBe(false);
	});

	test('ignores reasoning, tool calls, and tool results', () => {
		const rejected: AgentPersistedEnvelope[] = [
			{
				kind: 'message',
				payload: { kind: 'reasoning', text: 'Thinking.' },
				role: 'agent',
			},
			{
				kind: 'message',
				payload: {
					input: {},
					kind: 'tool-call',
					name: 'Read',
					toolCallId: 'c1',
				},
				role: 'agent',
			},
			{
				kind: 'message',
				payload: {
					isError: false,
					kind: 'tool-result',
					output: 'ok',
					toolCallId: 'c1',
				},
				role: 'tool',
			},
		];
		for (const envelope of rejected) {
			expect(isConciergeAgentMessage(envelope)).toBe(false);
		}
	});

	test('ignores the user’s own prompt and an unreadable payload', () => {
		expect(
			isConciergeAgentMessage({
				kind: 'message',
				payload: { kind: 'prompt', prompt: 'hello' },
				role: 'user',
			}),
		).toBe(false);
		expect(isConciergeAgentMessage(null)).toBe(false);
	});

	test('ignores a message whose only text is blank', () => {
		expect(isConciergeAgentMessage(agentMessage('   '))).toBe(false);
	});
});

describe('isConciergeStreamingStatus', () => {
	test('counts a turn spinning up as one in flight', () => {
		expect(isConciergeStreamingStatus('starting')).toBe(true);
		expect(isConciergeStreamingStatus('streaming')).toBe(true);
	});

	test('reads every resting status as idle', () => {
		for (const status of ['idle', 'errored', 'closed', 'unknown']) {
			expect(isConciergeStreamingStatus(status)).toBe(false);
		}
	});
});

describe('noteConciergeMessage', () => {
	test('counts each message on the same session', () => {
		const first = noteConciergeMessage(CONCIERGE_ACTIVITY_NONE, 'c1');
		const second = noteConciergeMessage(first, 'c1');
		expect(conciergeBadgeCount(second)).toBe(2);
		expect(second.sessionId).toBe('c1');
	});

	test('restarts when a clear replaced the session behind the count', () => {
		const held = noteConciergeMessage(
			noteConciergeMessage(CONCIERGE_ACTIVITY_NONE, 'c1'),
			'c1',
		);
		const replaced = noteConciergeMessage(held, 'c2');
		expect(replaced).toEqual({ count: 1, hasQuestion: false, sessionId: 'c2' });
	});

	test('leaves the input untouched', () => {
		const before = noteConciergeMessage(CONCIERGE_ACTIVITY_NONE, 'c1');
		noteConciergeMessage(before, 'c1');
		expect(before.count).toBe(1);
	});
});

describe('setConciergeQuestion', () => {
	test('adds one to the count while a questionnaire blocks', () => {
		const counted = noteConciergeMessage(CONCIERGE_ACTIVITY_NONE, 'c1');
		const blocked = setConciergeQuestion(counted, 'c1', true);
		expect(conciergeBadgeCount(blocked)).toBe(2);
	});

	test('reports a question on its own even with nothing counted', () => {
		const blocked = setConciergeQuestion(CONCIERGE_ACTIVITY_NONE, 'c1', true);
		expect(conciergeBadgeCount(blocked)).toBe(1);
	});

	test('drops the count when the question belongs to a replacement session', () => {
		const counted = noteConciergeMessage(CONCIERGE_ACTIVITY_NONE, 'c1');
		expect(setConciergeQuestion(counted, 'c2', true)).toEqual({
			count: 0,
			hasQuestion: true,
			sessionId: 'c2',
		});
	});

	test('answering the question takes its one back off', () => {
		const blocked = setConciergeQuestion(CONCIERGE_ACTIVITY_NONE, 'c1', true);
		expect(
			conciergeBadgeCount(setConciergeQuestion(blocked, 'c1', false)),
		).toBe(0);
	});

	test('is identity when nothing changes, so no render is spent', () => {
		const blocked = setConciergeQuestion(CONCIERGE_ACTIVITY_NONE, 'c1', true);
		expect(setConciergeQuestion(blocked, 'c1', true)).toBe(blocked);
		expect(setConciergeQuestion(CONCIERGE_ACTIVITY_NONE, null, false)).toBe(
			CONCIERGE_ACTIVITY_NONE,
		);
	});

	test('ignores a question raised before a session is known', () => {
		expect(setConciergeQuestion(CONCIERGE_ACTIVITY_NONE, null, true)).toBe(
			CONCIERGE_ACTIVITY_NONE,
		);
	});
});

describe('clearConciergeActivity', () => {
	test('empties whatever was held', () => {
		const held = setConciergeQuestion(
			noteConciergeMessage(CONCIERGE_ACTIVITY_NONE, 'c1'),
			'c1',
			true,
		);
		expect(conciergeBadgeCount(clearConciergeActivity(held))).toBe(0);
	});

	test('is identity on an already-empty state', () => {
		expect(clearConciergeActivity(CONCIERGE_ACTIVITY_NONE)).toBe(
			CONCIERGE_ACTIVITY_NONE,
		);
	});
});
