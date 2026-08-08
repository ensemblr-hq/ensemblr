import { describe, expect, test } from 'vitest';

import {
	createTimelineProjector,
	eventsToUIMessages,
} from '../../src/renderer/lib/agent-timeline/event-to-ui-message';
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

function prompt(id: string, ordinal: number, text: string) {
	return event({
		id,
		ordinal,
		payload: {
			kind: 'message',
			payload: { kind: 'prompt', prompt: text },
			role: 'user',
		},
		turnId: `turn-${ordinal}`,
	});
}

function answer(id: string, ordinal: number, text: string) {
	return event({
		id,
		ordinal,
		payload: {
			kind: 'message',
			payload: { kind: 'text', text },
			role: 'agent',
		},
		turnId: `turn-${ordinal}`,
	});
}

function skillPrompt(id: string, ordinal: number, skill: string, text: string) {
	return prompt(
		id,
		ordinal,
		[
			`<skill name="${skill}" location="/skills/${skill}/SKILL.md">`,
			'Respond terse.',
			'</skill>',
			'',
			text,
		].join('\n'),
	);
}

function delta(id: string, ordinal: number, text: string) {
	return event({
		id,
		ordinal,
		payload: {
			kind: 'message',
			payload: { kind: 'text-delta', text },
			role: 'agent',
		},
		turnId: 'turn-live',
	});
}

const SETTLED = [
	prompt('evt-1', 0, 'first question'),
	answer('evt-2', 1, 'first answer'),
	prompt('evt-3', 2, 'second question'),
	answer('evt-4', 3, 'second answer'),
];

describe('createTimelineProjector', () => {
	test('matches a full fold as deltas append to the run', () => {
		const project = createTimelineProjector();
		const events = [...SETTLED, prompt('evt-5', 4, 'third question')];

		for (const text of ['Hel', 'lo ', 'world']) {
			events.push(delta(`evt-delta-${events.length}`, events.length, text));
			expect(project(events)).toEqual(eventsToUIMessages(events));
		}
	});

	test('leaves settled turns referentially identical while one streams', () => {
		const project = createTimelineProjector();
		const events = [...SETTLED, prompt('evt-5', 4, 'third question')];
		project(events);

		events.push(delta('evt-6', 5, 'Hel'));
		const first = project(events);
		events.push(delta('evt-7', 6, 'lo'));
		const second = project(events);

		expect(second.slice(0, 4)).toEqual(first.slice(0, 4));
		for (const index of [0, 1, 2, 3]) {
			expect(second[index]).toBe(first[index]);
		}
		expect(second.at(-1)).not.toBe(first.at(-1));
	});

	test('refolds from the start when handed an unrelated run', () => {
		const project = createTimelineProjector();
		project(SETTLED);

		const other = [
			prompt('other-1', 0, 'different question'),
			answer('other-2', 1, 'different answer'),
		];

		expect(project(other)).toEqual(eventsToUIMessages(other));
	});

	test('refolds when the last folded row is replaced rather than appended', () => {
		const project = createTimelineProjector();
		project(SETTLED);

		const corrected = [
			...SETTLED.slice(0, 3),
			answer('evt-4', 3, 'corrected answer'),
		];

		expect(project(corrected)).toEqual(eventsToUIMessages(corrected));
	});

	test('refolds when a row inside the folded prefix is replaced', () => {
		const project = createTimelineProjector();
		project(SETTLED);

		const corrected = [
			SETTLED[0],
			answer('evt-2', 1, 'corrected first answer'),
			SETTLED[2],
			SETTLED[3],
		];

		expect(project(corrected)).toEqual(eventsToUIMessages(corrected));
	});

	test('leaves settled skill turns referentially identical while one streams', () => {
		const project = createTimelineProjector();
		const events = [
			skillPrompt('evt-skill', 0, 'caveman', 'summarize the diff'),
			answer('evt-answer', 1, 'Done.'),
			prompt('evt-next', 2, 'and now this'),
		];
		project(events);

		events.push(delta('evt-d1', 3, 'Hel'));
		const first = project(events);
		events.push(delta('evt-d2', 4, 'lo'));
		const second = project(events);

		expect(first).toHaveLength(4);
		for (const index of [0, 1, 2]) {
			expect(second[index]).toBe(first[index]);
		}
		expect(second.at(-1)).not.toBe(first.at(-1));
	});

	test('keeps a standalone skill activation row stable while one streams', () => {
		const project = createTimelineProjector();
		const events = [
			skillPrompt('evt-skill', 0, 'caveman', 'summarize the diff'),
			prompt('evt-next', 1, 'never mind'),
		];
		project(events);

		events.push(delta('evt-d1', 2, 'Hel'));
		const first = project(events);
		events.push(delta('evt-d2', 3, 'lo'));
		const second = project(events);

		expect(first[1]?.parts).toEqual([
			{ data: { name: 'caveman' }, type: 'data-pi-skill' },
		]);
		for (const index of [0, 1, 2]) {
			expect(second[index]).toBe(first[index]);
		}
	});
});
