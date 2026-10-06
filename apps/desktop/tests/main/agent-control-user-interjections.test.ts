import { describe, expect, it } from 'vitest';

import { createUserInterjections } from '../../src/main/agent-control/user-interjections.ts';
import type { AgentPersistedEnvelope } from '../../src/shared/ipc/contracts/agent-message-payloads.ts';

const toolResult = (
	toolCallId: string,
	parentToolCallId?: string,
): AgentPersistedEnvelope => ({
	kind: 'message',
	...(parentToolCallId ? { parentToolCallId } : {}),
	payload: { isError: false, kind: 'tool-result', output: 'ok', toolCallId },
	role: 'tool',
});

const subAgentText = (parentToolCallId: string): AgentPersistedEnvelope => ({
	kind: 'message',
	parentToolCallId,
	payload: { kind: 'text', text: 'sub-agent at work' },
	role: 'agent',
});

/** Arms `s1` and reports whether its next wait starts already interjected. */
const armedAfter = (
	events: readonly (AgentPersistedEnvelope | null)[],
): boolean => {
	const interjections = createUserInterjections();
	interjections.noteSteer('s1');
	for (const event of events) {
		interjections.noteEvent('s1', event);
	}
	return interjections.watch('s1', undefined).interjected();
};

describe('agent-control user interjections', () => {
	it('aborts every open wait of the steered session', () => {
		const interjections = createUserInterjections();
		const first = interjections.watch('s1', undefined);
		const second = interjections.watch('s1', undefined);

		interjections.noteSteer('s1');

		for (const watch of [first, second]) {
			expect(watch.signal.aborted).toBe(true);
			expect(watch.interjected()).toBe(true);
		}
	});

	it('leaves another session’s wait running', () => {
		const interjections = createUserInterjections();
		const watch = interjections.watch('s1', undefined);

		interjections.noteSteer('s2');

		expect(watch.signal.aborted).toBe(false);
		expect(watch.interjected()).toBe(false);
	});

	it('arms the next wait when none is open, and spends the arm on it', () => {
		const interjections = createUserInterjections();
		interjections.noteSteer('s1');

		const armed = interjections.watch('s1', undefined);
		const next = interjections.watch('s1', undefined);

		expect(armed.interjected()).toBe(true);
		expect(armed.signal.aborted).toBe(true);
		expect(next.signal.aborted).toBe(false);
	});

	it('spends a steer on the waits it ended rather than arming the next', () => {
		const interjections = createUserInterjections();
		interjections.watch('s1', undefined);

		interjections.noteSteer('s1');

		expect(interjections.watch('s1', undefined).signal.aborted).toBe(false);
	});

	it('no longer reaches a released wait', () => {
		const interjections = createUserInterjections();
		const released = interjections.watch('s1', undefined);
		released.release();

		interjections.noteSteer('s1');

		expect(released.signal.aborted).toBe(false);
		expect(interjections.watch('s1', undefined).interjected()).toBe(true);
	});

	it('follows the calling turn’s signal without calling it a steer', () => {
		const interjections = createUserInterjections();
		const turn = new AbortController();
		const watch = interjections.watch('s1', turn.signal);

		turn.abort();

		expect(watch.signal.aborted).toBe(true);
		expect(watch.interjected()).toBe(false);
	});

	it('lets a turn that ended outrank a steer', () => {
		const interjections = createUserInterjections();
		interjections.noteSteer('s1');

		const watch = interjections.watch('s1', AbortSignal.abort());

		expect(watch.signal.aborted).toBe(true);
		expect(watch.interjected()).toBe(false);
	});

	it('forgets an armed steer when the session ends', () => {
		const interjections = createUserInterjections();
		interjections.noteSteer('s1');
		interjections.forget('s1');

		expect(interjections.watch('s1', undefined).interjected()).toBe(false);
	});
});

describe('agent-control user interjections: delivery boundaries', () => {
	it('disarms at a main-thread tool result, in either message shape', () => {
		expect(armedAfter([toolResult('read-1')])).toBe(false);
		expect(
			armedAfter([
				{
					kind: 'message',
					payload: {
						kind: 'message',
						parts: [
							{
								isError: false,
								kind: 'tool-result',
								output: 'ok',
								toolCallId: 'read-1',
							},
						],
						role: 'user',
					},
					role: 'user',
				},
			]),
		).toBe(false);
	});

	// Pi flushes the steering it holds after an answer that ends without a tool
	// call and carries on in the same run, so status never leaves `streaming`.
	it('disarms at an answer that ended without a tool call', () => {
		expect(
			armedAfter([
				{
					kind: 'message',
					payload: {
						endsResponse: true,
						kind: 'message',
						parts: [{ kind: 'text', text: 'Done.' }],
						role: 'assistant',
					},
					role: 'agent',
				},
			]),
		).toBe(false);
	});

	it('disarms when the turn leaves streaming, and not before', () => {
		expect(
			armedAfter([{ kind: 'status', previous: 'streaming', status: 'idle' }]),
		).toBe(false);
		expect(
			armedAfter([{ kind: 'status', previous: 'idle', status: 'streaming' }]),
		).toBe(true);
	});

	it('stays armed through text and a sub-agent’s own tool result', () => {
		expect(
			armedAfter([
				{
					kind: 'message',
					payload: { kind: 'text', text: 'thinking aloud' },
					role: 'agent',
				},
				toolResult('inner-1', 'task-1'),
				null,
			]),
		).toBe(true);
	});
});

describe('agent-control user interjections: sub-agent calls', () => {
	it('ignores a steer while the main thread is inside a sub-agent call', () => {
		const interjections = createUserInterjections();
		interjections.noteEvent('s1', subAgentText('task-1'));
		const watch = interjections.watch('s1', undefined);

		interjections.noteSteer('s1');

		expect(watch.signal.aborted).toBe(false);
		watch.release();
		expect(interjections.watch('s1', undefined).interjected()).toBe(false);
	});

	it('honours a steer again once the sub-agent call returns', () => {
		const interjections = createUserInterjections();
		interjections.noteEvent('s1', subAgentText('task-1'));
		interjections.noteEvent('s1', toolResult('task-1'));
		const watch = interjections.watch('s1', undefined);

		interjections.noteSteer('s1');

		expect(watch.interjected()).toBe(true);
	});

	it('keeps ignoring a steer while another sub-agent call is still open', () => {
		const interjections = createUserInterjections();
		interjections.noteEvent('s1', subAgentText('task-1'));
		interjections.noteEvent('s1', subAgentText('task-2'));
		interjections.noteEvent('s1', toolResult('task-1'));
		const watch = interjections.watch('s1', undefined);

		interjections.noteSteer('s1');

		expect(watch.signal.aborted).toBe(false);
	});

	it('drops open sub-agent calls when the turn settles', () => {
		const interjections = createUserInterjections();
		interjections.noteEvent('s1', subAgentText('task-1'));
		interjections.noteEvent('s1', {
			kind: 'status',
			previous: 'streaming',
			status: 'idle',
		});
		const watch = interjections.watch('s1', undefined);

		interjections.noteSteer('s1');

		expect(watch.interjected()).toBe(true);
	});
});
