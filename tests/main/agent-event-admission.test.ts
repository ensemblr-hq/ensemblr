import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '../../src/main/agent-runtime/agent-types.ts';
import { isTimelineAgentEvent } from '../../src/main/agent-runtime/event-admission.ts';
import { createRuntimeEventHandler } from '../../src/main/agent-runtime/session/handle-runtime-event.ts';
import type { AgentEventRow } from '../../src/main/storage/repositories/agent-event-repository.ts';

const AT = '2026-09-12T10:00:00.000Z';

function unknownFrame(frameType: string): AgentEvent {
	return {
		at: AT,
		payload: { frameType, kind: 'unknown', raw: { type: frameType } },
		role: 'agent',
		turnId: null,
		type: 'message',
	};
}

function textMessage(text: string): AgentEvent {
	return {
		at: AT,
		payload: { kind: 'text', text },
		role: 'agent',
		turnId: null,
		type: 'message',
	};
}

function persistedRow(): AgentEventRow {
	return {
		branchId: 'branch-1',
		createdAt: AT,
		eventType: 'message',
		id: 'event-1',
		ordinal: 0,
		payload: {
			kind: 'message',
			payload: { kind: 'text', text: 'hi' },
			role: 'agent',
		},
		stream: 'protocol',
		turnId: null,
	};
}

function buildHandler() {
	const persistRuntimeEvent = vi.fn(() => persistedRow());
	const eventSink = vi.fn();
	const handler = createRuntimeEventHandler({
		activeSessions: new Map(),
		eventSink,
		now: () => new Date(AT),
		persistRuntimeEvent,
		queueNaming: vi.fn(),
		summaryQueue: {
			flushPendingSummaries: vi.fn(),
			queueSummaryAfterAgentResponse: vi.fn(),
		} as never,
	});

	return { eventSink, handler, persistRuntimeEvent };
}

describe('isTimelineAgentEvent', () => {
	it('rejects an unmodelled runtime frame', () => {
		expect(isTimelineAgentEvent(unknownFrame('extension_ui_request'))).toBe(
			false,
		);
	});

	it('admits every event the timeline renders', () => {
		const admitted: readonly AgentEvent[] = [
			textMessage('hello'),
			{ at: AT, reason: 'completed', type: 'shutdown' },
			{ at: AT, previous: 'idle', status: 'streaming', type: 'status' },
		];

		for (const event of admitted) {
			expect(isTimelineAgentEvent(event)).toBe(true);
		}
	});
});

describe('createRuntimeEventHandler', () => {
	it('neither persists nor broadcasts an unmodelled frame', () => {
		const { eventSink, handler, persistRuntimeEvent } = buildHandler();

		handler.handle({
			branchId: 'branch-1',
			database: {} as DatabaseSync,
			event: unknownFrame('extension_ui_request'),
			sessionId: 'session-1',
		});

		expect(persistRuntimeEvent).not.toHaveBeenCalled();
		expect(eventSink).not.toHaveBeenCalled();
	});

	it('still persists and broadcasts a renderable message', () => {
		const { eventSink, handler, persistRuntimeEvent } = buildHandler();

		handler.handle({
			branchId: 'branch-1',
			database: {
				prepare: () => ({ get: () => ({ workspace_id: 'ws-1' }) }),
			} as unknown as DatabaseSync,
			event: textMessage('hello'),
			sessionId: 'session-1',
		});

		expect(persistRuntimeEvent).toHaveBeenCalledTimes(1);
		expect(eventSink).toHaveBeenCalledTimes(1);
	});
});
