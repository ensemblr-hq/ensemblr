import { useEffect, useRef } from 'react';

import type { FollowUpQueueApi } from '@/renderer/state/composer';
import type { FollowUpBehavior } from '@/renderer/state/preferences';
import type { QueuedFollowUp } from '@/renderer/types/workbench';

/**
 * Whether the head of the queue may go on its own once the agent stops.
 *
 * The `block` behavior means "never interrupt", so a message the user queued
 * under it waits for them to send it by hand. A Checks-panel chore drains under
 * every behavior: the panel already told the user it had been handed over, so
 * silently parking it would make that report a lie.
 * @param entry - The entry at the head of the queue
 * @param behavior - The Follow-up behavior setting
 * @returns True when the flush may send it without the user asking
 */
export function flushesAutomatically(
	entry: QueuedFollowUp,
	behavior: FollowUpBehavior,
): boolean {
	return entry.source === 'chore' || behavior !== 'block';
}

/**
 * Whether a turn end has an entry to answer it. False for a paused queue, an
 * empty one, and one whose head is a message the behavior holds back — the three
 * ways a turn end is settled rather than merely postponed.
 * @param queue - The chat's follow-up queue
 * @param behavior - The Follow-up behavior setting
 * @returns True when the head may be sent now
 */
function hasSendableHead(
	queue: FollowUpQueueApi,
	behavior: FollowUpBehavior,
): boolean {
	if (queue.held) {
		return false;
	}
	const [head] = queue.entries;
	return head !== undefined && flushesAutomatically(head, behavior);
}

/**
 * Sends queued follow-ups once the agent stops, one per turn end.
 *
 * Keys off the falling edge of `isStreaming` rather than its current value: the
 * queue only exists because a turn was running, so "not streaming" on its own
 * would fire against a composer that had simply mounted idle. Sending the head
 * raises `isStreaming` again, so the next entry goes on the next edge — which
 * makes ordering trivially FIFO, gives each queued message its own turn, and
 * leaves the remainder queued and visible if one fails partway through.
 *
 * The edge is remembered rather than read once, because the two reasons a flush
 * can be refused are not alike. A composer that is momentarily busy or disabled
 * will free up, so the edge waits for it; a queue that is held or whose head
 * will not go on its own has answered the edge, and it is dropped. Reading the
 * edge once would let a turn that ended during a send strand the queue until
 * some later turn happened to end.
 * @param input - The behavior, streaming state, whether the composer can send, the queue, and the send pipeline
 */
export function useFollowUpFlush({
	behavior,
	canSend,
	isStreaming,
	queue,
	submit,
}: {
	behavior: FollowUpBehavior;
	canSend: boolean;
	isStreaming: boolean;
	queue: FollowUpQueueApi;
	/** Sends one entry the queue handed over; resolves false when it could not be delivered. */
	submit: (entry: QueuedFollowUp) => Promise<boolean>;
}): void {
	const wasStreamingRef = useRef(isStreaming);
	const turnEndedRef = useRef(false);
	const flushingRef = useRef(false);

	useEffect(() => {
		if (isStreaming) {
			turnEndedRef.current = false;
		} else if (wasStreamingRef.current) {
			turnEndedRef.current = true;
		}
		wasStreamingRef.current = isStreaming;
		if (!turnEndedRef.current || flushingRef.current || !canSend) {
			return;
		}
		turnEndedRef.current = false;
		if (!hasSendableHead(queue, behavior)) {
			return;
		}
		const next = queue.takeNext();
		if (!next) {
			return;
		}
		flushingRef.current = true;
		void submit(next).finally(() => {
			flushingRef.current = false;
		});
	}, [behavior, canSend, isStreaming, queue, submit]);
}
