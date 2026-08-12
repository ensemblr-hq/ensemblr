// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { createStore, Provider as JotaiProvider } from 'jotai';
import type { ReactNode } from 'react';
import { describe, expect, test } from 'vitest';

import {
	followUpQueueAtomFamily,
	useFollowUpQueue,
} from '@/renderer/state/composer';
import type { QueuedFollowUp } from '@/renderer/types/workbench';

const CHAT_TAB_ID = 'chat-1';

function entry(id: string): QueuedFollowUp {
	return {
		id,
		queuedAt: '2026-08-12T00:00:00.000Z',
		segments: [],
		snapshot: null,
		source: 'user',
		text: id,
	};
}

/** Renders the queue hook against a fresh store seeded with the given entries. */
function renderQueue(seed: readonly QueuedFollowUp[]) {
	const store = createStore();
	store.set(followUpQueueAtomFamily(CHAT_TAB_ID), seed);
	const rendered = renderHook(() => useFollowUpQueue(CHAT_TAB_ID), {
		wrapper: ({ children }: { children: ReactNode }) => (
			<JotaiProvider store={store}>{children}</JotaiProvider>
		),
	});
	return {
		ids: () =>
			store.get(followUpQueueAtomFamily(CHAT_TAB_ID)).map((one) => one.id),
		result: rendered.result,
	};
}

describe('lifting an entry out of the queue', () => {
	test('hands back the place it was holding', () => {
		const { result } = renderQueue([entry('a'), entry('b'), entry('c')]);

		let taken: ReturnType<typeof result.current.take> = null;
		act(() => {
			taken = result.current.take('c');
		});

		expect(taken).toMatchObject({ entry: { id: 'c' }, index: 2 });
	});

	test('answers null for an id the queue does not hold', () => {
		const { result, ids } = renderQueue([entry('a')]);

		let taken: ReturnType<typeof result.current.take> = null;
		act(() => {
			taken = result.current.take('gone');
		});

		expect(taken).toBeNull();
		expect(ids()).toEqual(['a']);
	});

	// A steer that does not land used to drop the row back at the front, so
	// failing to send the third message promoted it past two the user had
	// deliberately put in front of it.
	test('putting it back at its index restores the order it was taken from', () => {
		const { result, ids } = renderQueue([entry('a'), entry('b'), entry('c')]);

		act(() => {
			const taken = result.current.take('c');
			if (taken) {
				result.current.requeue(taken.entry, taken.index);
			}
		});

		expect(ids()).toEqual(['a', 'b', 'c']);
	});

	test('putting it back without an index puts it at the head, for the flush', () => {
		const { result, ids } = renderQueue([entry('a'), entry('b')]);

		act(() => {
			const head = result.current.takeNext();
			if (head) {
				result.current.requeue(head);
			}
		});

		expect(ids()).toEqual(['a', 'b']);
	});
});
