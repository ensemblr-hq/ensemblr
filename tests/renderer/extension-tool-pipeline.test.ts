import { describe, expect, test } from 'vitest';
import { eventsToUIMessages } from '../../src/renderer/lib/agent-timeline/event-to-ui-message';
import type {
	AgentPersistedEnvelope,
	AgentSessionEventWire,
} from '../../src/shared/ipc';
import type { ToolPresentationV1 } from '../../src/shared/tool-presentation';

type MessagePayload = Extract<
	AgentPersistedEnvelope,
	{ kind: 'message' }
>['payload'];

function event(
	id: string,
	ordinal: number,
	payload: MessagePayload,
	parentToolCallId?: string,
): AgentSessionEventWire {
	return {
		branchId: 'branch-1',
		createdAt: `2026-06-08T12:00:${String(ordinal).padStart(2, '0')}.000Z`,
		eventType: 'message',
		id,
		ordinal,
		payload: {
			kind: 'message',
			parentToolCallId,
			payload,
			role: 'tool',
		},
		stream: 'protocol',
		turnId: 'turn-1',
	};
}

const firstPresentation: ToolPresentationV1 = {
	body: { kind: 'markdown', text: 'Started **searching**.' },
	glyph: 'search',
	title: { el: 'Αναζήτηση', en: 'Searching', ru: 'Поиск' },
	version: 1,
};

const secondPresentation: ToolPresentationV1 = {
	body: { kind: 'code', code: 'result', language: 'text' },
	title: { en: 'Found results', ru: 'Найдены результаты' },
	version: 1,
};

function toolPart(messages: ReturnType<typeof eventsToUIMessages>) {
	return messages[0]?.parts.find((part) => part.type === 'dynamic-tool');
}

describe('extension-owned tool timeline snapshots', () => {
	test('merges start, updates, and final result while preserving identity', () => {
		const messages = eventsToUIMessages([
			event('start', 0, {
				kind: 'tool-call',
				input: { query: 'react' },
				name: 'search_docs',
				toolCallId: 'call-1',
			}),
			event('update', 1, {
				input: { query: 'react' },
				kind: 'tool-update',
				name: 'search_docs',
				presentation: firstPresentation,
				toolCallId: 'call-1',
			}),
			event('final', 2, {
				isError: false,
				kind: 'tool-result',
				output: {
					content: [{ text: 'done' }],
					details: { ensemblr: { presentation: secondPresentation } },
				},
				toolCallId: 'call-1',
			}),
		]);

		expect(toolPart(messages)).toMatchObject({
			input: { query: 'react' },
			output: { text: 'done' },
			state: 'output-available',
			toolCallId: 'call-1',
			toolName: 'search_docs',
			toolPresentation: secondPresentation,
		});
	});

	test('does not let duplicate starts erase progress or parent linkage', () => {
		const messages = eventsToUIMessages([
			event(
				'start',
				0,
				{
					input: { query: 'react' },
					kind: 'tool-call',
					name: 'search_docs',
					toolCallId: 'call-1',
				},
				'parent-1',
			),
			event('update', 1, {
				input: { query: 'react' },
				kind: 'tool-update',
				name: 'search_docs',
				presentation: firstPresentation,
				toolCallId: 'call-1',
			}),
			event('duplicate', 2, {
				input: {},
				kind: 'tool-call',
				name: 'tool',
				toolCallId: 'call-1',
			}),
		]);

		expect(toolPart(messages)).toMatchObject({
			input: { query: 'react' },
			parentToolCallId: 'parent-1',
			toolName: 'search_docs',
			toolPresentation: firstPresentation,
		});
	});

	test('keeps interleaved calls independent', () => {
		const messages = eventsToUIMessages([
			event('start-1', 0, {
				input: { query: 'one' },
				kind: 'tool-call',
				name: 'search_one',
				toolCallId: 'call-1',
			}),
			event('start-2', 1, {
				input: { query: 'two' },
				kind: 'tool-call',
				name: 'search_two',
				toolCallId: 'call-2',
			}),
			event('update-1', 2, {
				input: { query: 'one' },
				kind: 'tool-update',
				name: 'search_one',
				presentation: firstPresentation,
				toolCallId: 'call-1',
			}),
		]);

		const tools = messages[0]?.parts.filter(
			(part) => part.type === 'dynamic-tool',
		);
		expect(tools).toHaveLength(2);
		expect(tools?.[0]).toMatchObject({
			toolCallId: 'call-1',
			toolPresentation: firstPresentation,
		});
		expect(tools?.[1]).toMatchObject({ toolCallId: 'call-2' });
	});

	test('ignores late updates after a completed or errored result', () => {
		const completed = eventsToUIMessages([
			event('start', 0, {
				input: { query: 'react' },
				kind: 'tool-call',
				name: 'search_docs',
				toolCallId: 'call-1',
			}),
			event('final', 1, {
				isError: false,
				kind: 'tool-result',
				output: { content: [{ text: 'done' }] },
				toolCallId: 'call-1',
			}),
			event('late', 2, {
				input: { query: 'late' },
				kind: 'tool-update',
				name: 'late_name',
				presentation: firstPresentation,
				toolCallId: 'call-1',
			}),
		]);
		expect(toolPart(completed)).toMatchObject({
			input: { query: 'react' },
			state: 'output-available',
			toolName: 'search_docs',
		});
		expect(toolPart(completed)).not.toHaveProperty('toolPresentation');

		const errored = eventsToUIMessages([
			event('start', 0, {
				input: { query: 'react' },
				kind: 'tool-call',
				name: 'search_docs',
				toolCallId: 'call-1',
			}),
			event('error', 1, {
				isError: true,
				kind: 'tool-result',
				output: { content: [{ text: 'failed' }] },
				toolCallId: 'call-1',
			}),
			event('late', 2, {
				input: { query: 'late' },
				kind: 'tool-update',
				name: 'late_name',
				presentation: firstPresentation,
				toolCallId: 'call-1',
			}),
		]);
		expect(toolPart(errored)).toMatchObject({
			input: { query: 'react' },
			errorText: 'failed',
			state: 'output-error',
			toolName: 'search_docs',
		});
	});

	test('a final result without presentation clears a partial snapshot', () => {
		const messages = eventsToUIMessages([
			event('start', 0, {
				input: { query: 'react' },
				kind: 'tool-call',
				name: 'search_docs',
				toolCallId: 'call-1',
			}),
			event('update', 1, {
				input: { query: 'react' },
				kind: 'tool-update',
				name: 'search_docs',
				presentation: firstPresentation,
				toolCallId: 'call-1',
			}),
			event('final', 2, {
				isError: false,
				kind: 'tool-result',
				output: { content: [{ text: 'ordinary result' }] },
				toolCallId: 'call-1',
			}),
		]);
		expect(toolPart(messages)).not.toHaveProperty('toolPresentation');
	});
});
