import type { ConciergeSessionEventWire } from '@/shared/ipc/contracts/concierge';

/**
 * Folds one event into a transcript ordered by ordinal, dropping one already
 * there.
 *
 * Ordered rather than appended because the two writers race: the broadcast
 * delivers a live event the moment the runtime emits it, while the initial read
 * of the persisted rows is still in flight. An append would leave a hole the
 * transcript never repairs — nothing refetches it — and a duplicate would double
 * the turn for a window that reloaded mid-stream.
 * @param events - The transcript so far, ascending by ordinal.
 * @param event - The event to fold in.
 * @returns The transcript to keep, unchanged when the ordinal is already held.
 */
function foldEvent(
	events: readonly ConciergeSessionEventWire[],
	event: ConciergeSessionEventWire,
): readonly ConciergeSessionEventWire[] {
	const last = events.at(-1);
	if (!last || last.ordinal < event.ordinal) {
		return [...events, event];
	}
	if (events.some((held) => held.ordinal === event.ordinal)) {
		return events;
	}
	const index = events.findIndex((held) => held.ordinal > event.ordinal);
	return [...events.slice(0, index), event, ...events.slice(index)];
}

/**
 * Merges two Concierge transcript runs into one ordered by ordinal.
 *
 * Every event it keeps is the object it was handed, so the timeline projector —
 * which resumes its fold on pointer equality — still recognizes the prefix it
 * already folded.
 * @param events - The transcript already held.
 * @param incoming - Events to merge in, in any order.
 * @returns The merged transcript, unchanged when `incoming` adds nothing.
 */
export function mergeConciergeEvents(
	events: readonly ConciergeSessionEventWire[],
	incoming: readonly ConciergeSessionEventWire[],
): readonly ConciergeSessionEventWire[] {
	return incoming.reduce(foldEvent, events);
}
