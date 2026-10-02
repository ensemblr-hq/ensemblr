import type { DynamicToolUIPart } from 'ai';
import { describe, expect, test } from 'vitest';
import {
	failurePresentation,
	finalPresentation,
	initialPresentation,
	runningPresentation,
} from '../../docs/pi/examples/extension-owned-presenter/presenter';
import { normalizeToolExecutionFrame } from '../../src/main/pi-agent/pi-wire-normalizer';
import { eventsToUIMessages } from '../../src/renderer/lib/agent-timeline/event-to-ui-message';
import { presentToolCall } from '../../src/renderer/lib/agent-timeline/tool-presentation';
import type { AgentSessionEventWire } from '../../src/shared/ipc';
import { parseToolPresentation } from '../../src/shared/tool-presentation';

function event(
	ordinal: number,
	payload: ReturnType<typeof normalizeToolExecutionFrame>,
): AgentSessionEventWire {
	return {
		branchId: 'branch-1',
		createdAt: `2026-09-09T13:20:0${ordinal}.000Z`,
		eventType: 'message',
		id: `event-${ordinal}`,
		ordinal,
		payload: { kind: 'message', payload, role: 'tool' },
		stream: 'protocol',
		turnId: 'turn-1',
	};
}

function toolPart(events: readonly AgentSessionEventWire[]): DynamicToolUIPart {
	const part = eventsToUIMessages(events)[0]?.parts.find(
		(candidate) => candidate.type === 'dynamic-tool',
	);
	if (part?.type !== 'dynamic-tool') {
		throw new Error('Expected example tool part');
	}
	return part;
}

function update(ordinal: number, presentation: unknown): AgentSessionEventWire {
	return event(
		ordinal,
		normalizeToolExecutionFrame({
			args: { query: 'react' },
			partialResult: {
				content: [],
				details: { ensemblr: { presentation } },
			},
			toolCallId: 'example-1',
			toolName: 'example_search',
			type: 'tool_execution_update',
		}),
	);
}

const start = event(
	0,
	normalizeToolExecutionFrame({
		args: { query: 'react' },
		toolCallId: 'example-1',
		toolName: 'example_search',
		type: 'tool_execution_start',
	}),
);

describe('documented extension-owned presenter example', () => {
	test('validates every emitted snapshot and renders running presentation', () => {
		const snapshots = [
			initialPresentation(),
			runningPresentation('react', 1),
			finalPresentation('react', 1),
			failurePresentation(),
		];
		for (const snapshot of snapshots) {
			expect(parseToolPresentation(snapshot)).not.toBeNull();
		}

		const presentation = presentToolCall(
			toolPart([start, update(1, snapshots[0]), update(2, snapshots[1])]),
		);
		expect(presentation).toMatchObject({
			body: { kind: 'terminal' },
			glyph: 'arrow-up-right',
			running: true,
			title: 'Searching',
		});
	});

	test('renders the authoritative final snapshot through the real pipeline', () => {
		const final = finalPresentation('react', 1);
		const result = event(
			3,
			normalizeToolExecutionFrame({
				isError: false,
				result: {
					content: [{ text: 'Found one result for react', type: 'text' }],
					details: { ensemblr: { presentation: final } },
				},
				toolCallId: 'example-1',
				toolName: 'example_search',
				type: 'tool_execution_end',
			}),
		);

		expect(
			presentToolCall(
				toolPart([start, update(1, initialPresentation()), result]),
			),
		).toMatchObject({
			body: { kind: 'labeled' },
			glyph: 'audio-lines',
			title: 'Search complete',
		});
	});

	test('keeps host failure treatment authoritative', () => {
		const result = event(
			2,
			normalizeToolExecutionFrame({
				isError: true,
				result: { content: [{ text: 'example_search failed deliberately' }] },
				toolCallId: 'example-1',
				toolName: 'example_search',
				type: 'tool_execution_end',
			}),
		);

		expect(
			presentToolCall(
				toolPart([start, update(1, failurePresentation()), result]),
			),
		).toMatchObject({
			body: { kind: 'error' },
			glyph: 'circle-x',
			tone: 'destructive',
		});
	});
});
