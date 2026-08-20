import { atom, useAtomValue, useStore } from 'jotai';
import { atomFamily } from 'jotai-family';
import { useCallback, useMemo } from 'react';

import type {
	FollowUpQueueHoldReason,
	QueuedFollowUp,
} from '@/renderer/types/workbench';

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
 * Why a chat's queue is paused, keyed by chat-tab id, and null while it drains
 * normally. Set when the user stops a turn — a stop lowers the streaming flag
 * exactly like a natural finish, and draining into the silence the user just
 * asked for would send the very messages they were interrupting — and when a
 * send genuinely fails, so a broken session cannot empty the queue into the
 * void. The reason travels with the flag because a pause the user cannot explain
 * reads as the queue breaking rather than obeying them.
 */
const followUpQueueHoldReasonAtomFamily = atomFamily((_chatTabId: string) =>
	atom<FollowUpQueueHoldReason | null>(null),
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
	/** Why the queue is paused and will not drain on its own, or null while it does. */
	holdReason: FollowUpQueueHoldReason | null;
	hold: (reason: FollowUpQueueHoldReason) => void;
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
	const holdReason = useAtomValue(followUpQueueHoldReasonAtomFamily(chatTabId));

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
			hold: (reason) =>
				store.set(followUpQueueHoldReasonAtomFamily(chatTabId), reason),
			holdReason,
			move: (id, direction) =>
				update((queue) => moveFollowUp(queue, id, direction)),
			release: () =>
				store.set(followUpQueueHoldReasonAtomFamily(chatTabId), null),
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
		[chatTabId, entries, holdReason, store, update],
	);
}

/**
 * Evicts a chat's queue from the families, closed or deleted alike. A queued
 * message drains only through a mounted composer, which a closed tab no longer
 * has, so keeping one would park an undeliverable message the user has no memory
 * of leaving — the same reason `dropComposerSubmits` discards queued chores.
 * @param chatTabId - Chat-tab id whose queue should be dropped
 */
export function forgetFollowUpQueue(chatTabId: string): void {
	followUpQueueAtomFamily.remove(chatTabId);
	followUpQueueHoldReasonAtomFamily.remove(chatTabId);
}

/**
 * Discards another chat's queue and reports how many messages went with it, for
 * callers outside that chat's composer.
 *
 * The close path is the one that needs it: the count is what lets the close say
 * so, rather than silently dropping messages the user queued.
 * @returns A callback that drops the named chat's queue and returns its length
 */
export function useDropFollowUpQueue(): (chatTabId: string) => number {
	const store = useStore();
	return useCallback(
		(chatTabId: string) => {
			const dropped = store.get(followUpQueueAtomFamily(chatTabId)).length;
			forgetFollowUpQueue(chatTabId);
			return dropped;
		},
		[store],
	);
}

export { followUpQueueAtomFamily, followUpQueueHoldReasonAtomFamily };
