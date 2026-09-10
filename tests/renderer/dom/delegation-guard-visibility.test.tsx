// @vitest-environment happy-dom

import { fireEvent } from '@testing-library/react';
import type { UIMessage } from 'ai';
import { describe, expect, test } from 'vitest';
import {
	beforeDelegationToolCall,
	createDelegationBarrierState,
} from '../../../resources/pi-extensions/delegation-barrier.mts';
import { normalizeToolExecutionFrame } from '../../../src/main/pi-agent/pi-wire-normalizer';
import { ChatAssistantTurn } from '../../../src/renderer/components/chat-assistant-turn';
import { createTimelineProjector } from '../../../src/renderer/lib/agent-timeline/event-to-ui-message';
import type { AgentSessionEventWire } from '../../../src/shared/ipc';
import { renderWithProviders } from '../support/dom';

const spawning = beforeDelegationToolCall(createDelegationBarrierState(), {
	batchStartsChild: true,
	input: {},
	toolCallId: 'spawn',
	toolName: 'ensemblr_start_conversation',
}).state;

function blockReason(toolName: string, batchStartsChild = false): string {
	const decision = beforeDelegationToolCall(spawning, {
		batchStartsChild,
		input: {},
		toolCallId: 'blocked',
		toolName,
	});
	if (!decision.blockReason) throw new Error(`Expected ${toolName} blocked`);
	return decision.blockReason;
}

function toolEvents(toolName: string, text: string, isError = true) {
	return ['tool_execution_start', 'tool_execution_end'].map(
		(type, ordinal): AgentSessionEventWire => ({
			branchId: 'branch',
			createdAt: '2026-09-10T12:00:00.000Z',
			eventType: 'message',
			id: `event-${ordinal}`,
			ordinal,
			payload: {
				kind: 'message',
				payload: normalizeToolExecutionFrame({
					args: {},
					isError,
					result: { content: [{ type: 'text', text }] },
					toolCallId: 'blocked',
					toolName,
					type,
				}),
				role: 'agent',
			},
			stream: 'protocol',
			turnId: 'turn',
		}),
	);
}

function turn(message: UIMessage, isStreaming = false) {
	return (
		<ChatAssistantTurn
			isStreaming={isStreaming}
			message={message}
			timing={{ endMs: isStreaming ? null : 2_000, startMs: 1_000 }}
		/>
	);
}

describe('delegation guard visibility', () => {
	test.each([
		['ensemblr_read_conversation', false],
		['read', false],
		['bash', true],
		['extension_tool', false],
		['ensemblr_wait_for_agents', false],
		['ensemblr_send_follow_up', false],
		['ensemblr_close_tab', false],
	] as const)('hides a blocked %s live and on replay', (toolName, batch) => {
		const reason = blockReason(toolName, batch);
		const events = toolEvents(toolName, reason);
		const project = createTimelineProjector();
		const running = project(events.slice(0, 1))[0];
		const { container, rerender } = renderWithProviders(turn(running, true));
		expect(
			container.querySelector('[data-role="activity-row"]'),
		).not.toBeNull();

		const settled = project(events)[0];
		expect(settled.parts).toEqual([
			expect.objectContaining({ errorText: reason, state: 'output-error' }),
		]);
		rerender(turn(settled, true));
		expect(container.textContent).not.toContain(reason);
		expect(container.querySelector('[data-role="activity-row"]')).toBeNull();

		const replay = createTimelineProjector()(events)[0];
		expect(replay).toEqual(settled);
		rerender(
			turn({
				...replay,
				parts: [
					...replay.parts,
					{ type: 'text', state: 'done', text: 'Done.' },
				],
			}),
		);
		expect(container.textContent).toContain('Done.');
		expect(container.textContent).not.toContain(reason);
		expect(container.querySelector('[data-role="turn-summary"]')).toBeNull();
	});

	test.each([
		'denied-permission',
		'Child wait failed: connection refused',
		`Unrelated failure quoting: ${blockReason('read')}`,
	])('keeps genuine failures visible: %s', (error) => {
		const message = createTimelineProjector()(
			toolEvents('ensemblr_wait_for_agents', error),
		)[0];
		const { container } = renderWithProviders(turn(message));
		expect(container.textContent).toContain(error);
	});

	test('does not hide successful output quoting a guard message', () => {
		const reason = blockReason('read');
		const message = createTimelineProjector()(
			toolEvents('read', reason, false),
		)[0];
		const { container, getByRole } = renderWithProviders(turn(message));
		fireEvent.click(getByRole('button', { expanded: false }));
		expect(container.textContent).toContain(reason);
	});
});
