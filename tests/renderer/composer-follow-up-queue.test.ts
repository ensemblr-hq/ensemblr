import { describe, expect, test } from 'vitest';
import { flushesAutomatically } from '../../src/renderer/hooks/workbench-shell/composer/use-follow-up-flush';
import { resolveSendIntent } from '../../src/renderer/lib/workbench';
import {
	appendFollowUp,
	createFollowUpQueueHold,
	holdCoversEntry,
	moveFollowUp,
	removeFollowUp,
	reorderFollowUps,
} from '../../src/renderer/state/composer';
import type { QueuedFollowUp } from '../../src/renderer/types/workbench';

/** Builds a queue entry with just enough shape for the ordering rules. */
function entry(
	id: string,
	source: QueuedFollowUp['source'] = 'user',
): QueuedFollowUp {
	return {
		id,
		queuedAt: '2026-08-11T20:00:00.000Z',
		segments: [{ kind: 'text', text: id }],
		snapshot: null,
		source,
		text: id,
	};
}

const ids = (queue: readonly QueuedFollowUp[]) => queue.map((item) => item.id);

describe('follow-up queue ordering', () => {
	test('appends at the tail, so the queue reads in send order', () => {
		const queue = appendFollowUp(
			appendFollowUp([entry('a')], entry('b')),
			entry('c'),
		);

		expect(ids(queue)).toEqual(['a', 'b', 'c']);
	});

	test('removing one entry leaves the rest in order', () => {
		expect(
			ids(removeFollowUp([entry('a'), entry('b'), entry('c')], 'b')),
		).toEqual(['a', 'c']);
	});

	test('removing an id the queue does not hold returns the same queue', () => {
		const queue = [entry('a')];

		expect(removeFollowUp(queue, 'missing')).toBe(queue);
	});

	test('a move swaps with the neighbour and leaves everything else alone', () => {
		const queue = [entry('a'), entry('b'), entry('c')];

		expect(ids(moveFollowUp(queue, 'c', 'up'))).toEqual(['a', 'c', 'b']);
		expect(ids(moveFollowUp(queue, 'a', 'down'))).toEqual(['b', 'a', 'c']);
	});

	test('a move off either end is a no-op, by identity', () => {
		const queue = [entry('a'), entry('b')];

		expect(moveFollowUp(queue, 'a', 'up')).toBe(queue);
		expect(moveFollowUp(queue, 'b', 'down')).toBe(queue);
	});

	test('a drag applies the whole order it hands back', () => {
		const queue = [entry('a'), entry('b'), entry('c')];

		expect(ids(reorderFollowUps(queue, ['c', 'a', 'b']))).toEqual([
			'c',
			'a',
			'b',
		]);
	});

	test('an order that omits an entry keeps it rather than dropping it', () => {
		// A drag that races a queue write must never lose a message: the omitted
		// entry lands at the end instead of vanishing.
		const queue = [entry('a'), entry('b'), entry('c')];

		expect(ids(reorderFollowUps(queue, ['c', 'a']))).toEqual(['c', 'a', 'b']);
	});

	test('an order naming an unknown id ignores it', () => {
		const queue = [entry('a'), entry('b')];

		expect(ids(reorderFollowUps(queue, ['b', 'ghost', 'a']))).toEqual([
			'b',
			'a',
		]);
	});
});

describe('queue pauses', () => {
	test('a stop names the entries it parked and covers those alone', () => {
		const hold = createFollowUpQueueHold('turn-stopped', [
			entry('a'),
			entry('b'),
		]);

		expect(hold).toEqual({ entryIds: ['a', 'b'], reason: 'turn-stopped' });
		expect(holdCoversEntry(hold, 'a')).toBe(true);
		expect(holdCoversEntry(hold, 'b')).toBe(true);
	});

	test('a message queued after a stop is not one of the messages it parked', () => {
		// The whole of resuming without pressing Resume: the stop was about the
		// messages on screen when it happened, not about the queue as a container.
		const hold = createFollowUpQueueHold('turn-stopped', [entry('a')]);

		expect(holdCoversEntry(hold, 'later')).toBe(false);
	});

	test('a stop over an empty queue parks nothing, so it stores no pause', () => {
		// A hold naming no entries could never cover one, and a non-null pause that
		// pauses nothing makes every reader check the list before trusting the flag.
		expect(createFollowUpQueueHold('turn-stopped', [])).toBeNull();
	});

	test('a failed send pauses the queue whatever it holds, empty included', () => {
		const hold = createFollowUpQueueHold('send-failed', []);

		expect(hold).toEqual({ reason: 'send-failed' });
		expect(holdCoversEntry(hold, 'a')).toBe(true);
	});

	test('an emptied queue is still paused by a failed send but not by a stop', () => {
		// What lets a stop stop mattering once its messages are gone, while a
		// session that would not take the last message keeps the queue shut.
		const stopped = createFollowUpQueueHold('turn-stopped', [entry('a')]);
		const failed = createFollowUpQueueHold('send-failed', [entry('a')]);

		expect(holdCoversEntry(stopped, undefined)).toBe(false);
		expect(holdCoversEntry(failed, undefined)).toBe(true);
	});

	test('no pause covers nothing', () => {
		expect(holdCoversEntry(null, 'a')).toBe(false);
		expect(holdCoversEntry(null, undefined)).toBe(false);
	});
});

describe('automatic flushing', () => {
	test('a user message drains under steer and queue, but not under block', () => {
		expect(flushesAutomatically(entry('a'), 'steer')).toBe(true);
		expect(flushesAutomatically(entry('a'), 'queue')).toBe(true);
		expect(flushesAutomatically(entry('a'), 'block')).toBe(false);
	});

	test('a Checks chore drains under every behavior', () => {
		// The Checks panel already told the user the chore was handed over, so
		// parking it behind a manual send would make that report a lie.
		const chore = entry('a', 'chore');

		expect(flushesAutomatically(chore, 'steer')).toBe(true);
		expect(flushesAutomatically(chore, 'queue')).toBe(true);
		expect(flushesAutomatically(chore, 'block')).toBe(true);
	});
});

describe('send intent', () => {
	test('every behavior sends normally when the agent is idle', () => {
		expect(resolveSendIntent('steer', false)).toBe('send');
		expect(resolveSendIntent('queue', false)).toBe('send');
		expect(resolveSendIntent('block', false)).toBe('send');
	});

	test('mid-turn, each behavior names its own destination', () => {
		expect(resolveSendIntent('steer', true)).toBe('send');
		expect(resolveSendIntent('queue', true)).toBe('queue');
		expect(resolveSendIntent('block', true)).toBe('hold');
	});
});
