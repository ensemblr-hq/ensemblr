// @vitest-environment happy-dom

import type { UIMessage } from 'ai';
import { describe, expect, test } from 'vitest';
import { normalizeMessageEnd } from '../../../src/main/pi-agent/pi-wire-normalizer';
import { ChatAssistantTurn } from '../../../src/renderer/components/chat-assistant-turn';
import { createTimelineProjector } from '../../../src/renderer/lib/agent-timeline/event-to-ui-message';
import type { AgentSessionEventWire } from '../../../src/shared/ipc';
import { renderWithProviders } from '../support/dom';

const REPORT = 'Implemented and polished. All verification checks pass.';

function messageEvent(
	ordinal: number,
	message: Record<string, unknown>,
): AgentSessionEventWire {
	return {
		branchId: 'branch',
		createdAt: '2026-09-09T12:00:00.000Z',
		eventType: 'message',
		id: `event-${ordinal}`,
		ordinal,
		payload: {
			kind: 'message',
			payload: normalizeMessageEnd(message, 'agent'),
			role: 'agent',
		},
		stream: 'protocol',
		turnId: `message-${ordinal}`,
	};
}

function assistant(ordinal: number, text: string, stopReason = 'stop') {
	return messageEvent(ordinal, {
		content: [{ type: 'text', text }],
		role: 'assistant',
		stopReason,
	});
}

function notification(ordinal: number) {
	return messageEvent(ordinal, {
		content: 'A background task from an earlier run finished.',
		customType: 'background-task-notification',
		display: true,
		role: 'custom',
	});
}

function transcript(messages: UIMessage[]) {
	return (
		<>
			{messages.map((message) => (
				<ChatAssistantTurn
					key={message.id}
					isStreaming={false}
					message={message}
					timing={{ endMs: 2_000, startMs: 1_000 }}
				/>
			))}
		</>
	);
}

describe('Pi final message delivery', () => {
	test('keeps the report outside collapsed activity after queued background notifications', () => {
		const project = createTimelineProjector();
		const events = [assistant(0, REPORT)];
		const original = project(events)[0];
		events.push(notification(1), assistant(2, 'Stale notification.'));
		events.push(notification(3), assistant(4, 'Also stale.'));
		const messages = project(events);
		expect(messages).toHaveLength(3);
		expect(messages[0]).toBe(original);
		expect(createTimelineProjector()(events)).toEqual(messages);
		const { container } = renderWithProviders(transcript(messages));
		const answers = [...container.querySelectorAll('.text-sm')]
			.map((answer) => answer.textContent)
			.join('\n');
		expect(answers).toContain(REPORT);
		expect(answers).toContain('Stale notification.');
		expect(answers).toContain('Also stale.');
	});

	test('keeps a completed report visible when later work calls a real tool', () => {
		const messages = createTimelineProjector()([
			assistant(0, REPORT),
			messageEvent(1, {
				content: [
					{
						type: 'toolCall',
						id: 'read-1',
						name: 'read',
						arguments: { path: 'package.json' },
					},
				],
				role: 'assistant',
				stopReason: 'toolUse',
			}),
			assistant(2, 'Checked once more.'),
		]);
		expect(messages).toHaveLength(2);
		const { container } = renderWithProviders(transcript(messages));
		expect(container.querySelector('.text-sm')?.textContent).toContain(REPORT);
	});

	test.each(['toolUse', 'error', 'aborted', 'unknown'])(
		'does not split an unfinished %s response',
		(stopReason) => {
			const messages = createTimelineProjector()([
				assistant(0, 'Working commentary.', stopReason),
				notification(1),
				assistant(2, REPORT),
			]);
			expect(messages).toHaveLength(1);
		},
	);

	test('keeps a truncated length response visible before later work', () => {
		const messages = createTimelineProjector()([
			assistant(0, 'Truncated answer.', 'length'),
			notification(1),
			assistant(2, REPORT),
		]);
		expect(messages).toHaveLength(2);
	});

	test('does not mistake tool-bearing or empty stop messages for answers', () => {
		for (const content of [
			[{ type: 'text', text: '   ' }],
			[{ type: 'thinking', thinking: 'Still thinking.' }],
			[
				{ type: 'text', text: 'Read first.' },
				{ type: 'toolCall', id: 'read-1', name: 'read', arguments: {} },
			],
		]) {
			const messages = createTimelineProjector()([
				messageEvent(0, { content, role: 'assistant', stopReason: 'stop' }),
				assistant(1, REPORT),
			]);
			expect(messages).toHaveLength(1);
		}
	});

	test('keeps legacy responses separate at persisted idle boundaries', () => {
		const idle: AgentSessionEventWire = {
			...notification(1),
			eventType: 'status',
			payload: { kind: 'status', previous: 'streaming', status: 'idle' },
		};
		const messages = createTimelineProjector()([
			assistant(0, REPORT, 'unknown'),
			idle,
			notification(2),
			assistant(3, 'Stale notification.'),
		]);
		expect(messages).toHaveLength(2);
	});

	test('does not split the parent turn when a subagent completes', () => {
		const child = assistant(1, 'Child report.');
		if (child.payload?.kind !== 'message') throw new Error('Expected message');
		child.payload = { ...child.payload, parentToolCallId: 'child-task' };
		const messages = createTimelineProjector()([
			assistant(0, 'Waiting for child.', 'toolUse'),
			child,
			assistant(2, REPORT),
		]);
		expect(messages).toHaveLength(1);
	});
});
