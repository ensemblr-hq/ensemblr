import { atom, useAtomValue, useStore } from 'jotai';
import { atomFamily } from 'jotai-family';
import { useCallback, useMemo } from 'react';

import type { QueuedFollowUp } from '@/renderer/types/workbench';

/**
 * Messages waiting to reach a chat's agent once its current turn ends, keyed by
 * chat-tab id. Distinct from the Checks-panel channel in `composer-submit.ts`,
 * which is a transient hand-off between panels: this is durable per-tab user
 * input, visible and editable for as long as it waits, so the tab is the key
 * rather than a tag on a shared list.
 *
 * In-memory only, like the draft atoms it is made of. A queued message is unsent
 * input, and restoring one across a restart would put words in front of the user
 * that they have no memory of leaving there.
 */
const followUpQueueAtomFamily = atomFamily((_chatTabId: string) =>
	atom<readonly QueuedFollowUp[]>([]),
);

/**
 * Whether a chat's queue is paused, keyed by chat-tab id. Set when the user
 * stops a turn — a stop lowers the streaming flag exactly like a natural finish,
 * and draining into the silence the user just asked for would send the very
 * messages they were interrupting. Also set when a flush fails, so a broken
 * session cannot empty the queue into the void.
 */
const followUpQueueHeldAtomFamily = atomFamily((_chatTabId: string) =>
	atom(false),
);

/**
 * Appends an entry at the tail. Order is arrival order; the flush takes from the
 * head, so a queue reads top-to-bottom in the order it will be sent.
 * @param queue - The queue as it stands
 * @param entry - The entry to add
 * @returns A new queue with the entry at the end
 */
export function appendFollowUp(
	queue: readonly QueuedFollowUp[],
	entry: QueuedFollowUp,
): readonly QueuedFollowUp[] {
	return [...queue, entry];
}

/**
 * Drops one entry by id, leaving the rest in order.
 * @param queue - The queue as it stands
 * @param id - Id of the entry to drop
 * @returns A new queue without that entry, or the same queue when it held none
 */
export function removeFollowUp(
	queue: readonly QueuedFollowUp[],
	id: string,
): readonly QueuedFollowUp[] {
	const kept = queue.filter((entry) => entry.id !== id);
	return kept.length === queue.length ? queue : kept;
}

/**
 * Swaps an entry with its neighbour in the given direction.
 *
 * Returns the same queue when the move would run off either end, so the caller
 * can compare by identity to know whether anything changed and the row's
 * chevrons can disable themselves without a second bounds check.
 * @param queue - The queue as it stands
 * @param id - Id of the entry to move
 * @param direction - Which way to move it
 * @returns A new queue with the entry moved, or the same queue when it could not move
 */
export function moveFollowUp(
	queue: readonly QueuedFollowUp[],
	id: string,
	direction: 'down' | 'up',
): readonly QueuedFollowUp[] {
	const index = queue.findIndex((entry) => entry.id === id);
	const target = direction === 'up' ? index - 1 : index + 1;
	if (index === -1 || target < 0 || target >= queue.length) {
		return queue;
	}
	const moved = [...queue];
	[moved[index], moved[target]] = [moved[target], moved[index]];
	return moved;
}

/**
 * Reorders the queue to match an explicit id order, which is what a drag hands
 * back. Ids the queue does not hold are ignored, and entries the order omits
 * keep their relative places at the end, so a drag that races a remove cannot
 * silently drop a message.
 * @param queue - The queue as it stands
 * @param orderedIds - Entry ids in their new order
 * @returns A new queue in that order
 */
export function reorderFollowUps(
	queue: readonly QueuedFollowUp[],
	orderedIds: readonly string[],
): readonly QueuedFollowUp[] {
	const byId = new Map(queue.map((entry) => [entry.id, entry] as const));
	const moved = orderedIds
		.map((id) => byId.get(id))
		.filter((entry): entry is QueuedFollowUp => entry !== undefined);
	const seen = new Set(moved.map((entry) => entry.id));
	return [...moved, ...queue.filter((entry) => !seen.has(entry.id))];
}

/**
 * Builds a queue entry, stamping it with an id and the time it was queued.
 * @param input - The draft to queue and where it came from
 * @returns The entry to append
 */
export function createFollowUp(
	input: Omit<QueuedFollowUp, 'id' | 'queuedAt'>,
): QueuedFollowUp {
	return {
		...input,
		id: crypto.randomUUID(),
		queuedAt: new Date().toISOString(),
	};
}

/**
 * A queued entry lifted out of the queue, with the place it was holding. The two
 * travel together because every caller that takes an entry may have to put it
 * back, and putting it anywhere but where it came from silently reorders a queue
 * the user arranged by hand.
 */
export interface TakenFollowUp {
	entry: QueuedFollowUp;
	index: number;
}

/** Everything a composer needs to read and drive one chat's follow-up queue. */
export interface FollowUpQueueApi {
	clear: () => void;
	entries: readonly QueuedFollowUp[];
	/** Queues a draft and returns the entry it created. */
	enqueue: (input: Omit<QueuedFollowUp, 'id' | 'queuedAt'>) => QueuedFollowUp;
	/** True while the queue is paused and will not drain on its own. */
	held: boolean;
	hold: () => void;
	move: (id: string, direction: 'down' | 'up') => void;
	release: () => void;
	/** Applies an explicit id order, which is what a drag hands back. */
	reorder: (orderedIds: readonly string[]) => void;
	remove: (id: string) => void;
	/**
	 * Puts an entry back where it was, for a send that could not be delivered.
	 * Omitting the index puts it at the head, which is where the flush took it
	 * from.
	 */
	requeue: (entry: QueuedFollowUp, index?: number) => void;
	/** Removes an entry and hands it back with its place, for an edit or an out-of-turn send. */
	take: (id: string) => TakenFollowUp | null;
	/** Removes and returns the head, for the flush. */
	takeNext: () => QueuedFollowUp | null;
}

/**
 * Reads and drives one chat's follow-up queue. Every mutation goes through the
 * store rather than a render-scope value, because the flush fires from an effect
 * that must act on the queue as it stands at that moment, not as it stood when
 * the callback was built.
 * @param chatTabId - Chat whose queue this is
 * @returns The queue, its paused flag, and the operations over both
 */
export function useFollowUpQueue(chatTabId: string): FollowUpQueueApi {
	const store = useStore();
	const entries = useAtomValue(followUpQueueAtomFamily(chatTabId));
	const held = useAtomValue(followUpQueueHeldAtomFamily(chatTabId));

	const update = useCallback(
		(next: (queue: readonly QueuedFollowUp[]) => readonly QueuedFollowUp[]) => {
			const queueAtom = followUpQueueAtomFamily(chatTabId);
			store.set(queueAtom, next(store.get(queueAtom)));
		},
		[chatTabId, store],
	);

	return useMemo(
		() => ({
			clear: () => update(() => []),
			enqueue: (input) => {
				const entry = createFollowUp(input);
				update((queue) => appendFollowUp(queue, entry));
				return entry;
			},
			entries,
			held,
			hold: () => store.set(followUpQueueHeldAtomFamily(chatTabId), true),
			move: (id, direction) =>
				update((queue) => moveFollowUp(queue, id, direction)),
			release: () => store.set(followUpQueueHeldAtomFamily(chatTabId), false),
			remove: (id) => update((queue) => removeFollowUp(queue, id)),
			reorder: (orderedIds) =>
				update((queue) => reorderFollowUps(queue, orderedIds)),
			requeue: (entry, index = 0) =>
				update((queue) => [
					...queue.slice(0, index),
					entry,
					...queue.slice(index),
				]),
			take: (id) => {
				const queue = store.get(followUpQueueAtomFamily(chatTabId));
				const index = queue.findIndex((entry) => entry.id === id);
				const found = queue[index];
				if (!found) {
					return null;
				}
				update((current) => removeFollowUp(current, id));
				return { entry: found, index };
			},
			takeNext: () => {
				const queueAtom = followUpQueueAtomFamily(chatTabId);
				const [head] = store.get(queueAtom);
				if (!head) {
					return null;
				}
				update((queue) => removeFollowUp(queue, head.id));
				return head;
			},
		}),
		[chatTabId, entries, held, store, update],
	);
}

/**
 * Evicts a chat's queue from the families. Call only when a chat tab is
 * permanently deleted, matching `forgetComposerDraft` — a closed but restorable
 * tab keeps its queue exactly as it keeps its draft.
 * @param chatTabId - Chat-tab id whose queue should be dropped
 */
export function forgetFollowUpQueue(chatTabId: string): void {
	followUpQueueAtomFamily.remove(chatTabId);
	followUpQueueHeldAtomFamily.remove(chatTabId);
}

/**
 * Pauses another chat's queue, for callers outside that chat's composer.
 *
 * The close path is the one that needs it: a tab closed with messages still
 * waiting keeps them, but reopening it a day later must not drain them into the
 * first turn that ends. Messages the user walked away from are exactly the ones
 * they have no memory of leaving, so they come back listed and paused.
 * @returns A callback that pauses the named chat's queue
 */
export function useHoldFollowUpQueue(): (chatTabId: string) => void {
	const store = useStore();
	return useCallback(
		(chatTabId: string) => {
			store.set(followUpQueueHeldAtomFamily(chatTabId), true);
		},
		[store],
	);
}

export { followUpQueueAtomFamily, followUpQueueHeldAtomFamily };
