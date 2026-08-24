import { describe, expect, test } from 'vitest';

import { mergeConciergeEvents } from '@/renderer/lib/concierge';
import type { ConciergeSessionEventWire } from '@/shared/ipc/contracts/concierge';

/** One transcript row at the given ordinal. */
function event(ordinal: number): ConciergeSessionEventWire {
	return {
		createdAt: '2026-08-24T00:00:00.000Z',
		eventType: 'message',
		id: `evt-${ordinal}`,
		ordinal,
		payload: {
			kind: 'message',
			payload: { kind: 'text', text: `line ${ordinal}` },
			role: 'agent',
		},
		sessionId: 'concierge-1',
		stream: 'protocol',
	};
}

/** The ordinals a merged transcript holds, in the order it holds them. */
function ordinalsOf(events: readonly ConciergeSessionEventWire[]): number[] {
	return events.map((held) => held.ordinal);
}

describe('merging the Concierge transcript', () => {
	test('appends an event that follows the last one held', () => {
		const merged = mergeConciergeEvents([event(0), event(1)], [event(2)]);

		expect(ordinalsOf(merged)).toEqual([0, 1, 2]);
	});

	test('fills a hole the initial read left behind, in order', () => {
		// The broadcast lands while the persisted rows are still being read, so the
		// live tail is already in the cache when the fetch resolves. Appending would
		// leave the turn out of order forever — nothing ever refetches it.
		const merged = mergeConciergeEvents(
			[event(0), event(1), event(2)],
			[event(3), event(1)],
		);

		expect(ordinalsOf(merged)).toEqual([0, 1, 2, 3]);
	});

	test('drops an ordinal already held rather than doubling the turn', () => {
		const held = [event(0), event(1)];

		const merged = mergeConciergeEvents(held, [event(1)]);

		expect(merged).toBe(held);
	});

	test('keeps every event at the identity it was handed', () => {
		// The timeline projector resumes its fold on pointer equality, so a merge
		// that rebuilt its rows would refold the whole transcript per token.
		const first = event(0);
		const second = event(1);

		const merged = mergeConciergeEvents([first], [second]);

		expect(merged[0]).toBe(first);
		expect(merged[1]).toBe(second);
	});
});
