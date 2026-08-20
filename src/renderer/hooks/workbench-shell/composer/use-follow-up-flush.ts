import { useEffect, useState } from 'react';

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
	if (queue.holdReason !== null) {
		return false;
	}
	const [head] = queue.entries;
	return head !== undefined && flushesAutomatically(head, behavior);
}

/**
 * Sends queued follow-ups whenever the agent is not working, one at a time.
 *
 * Reads the standing state rather than the falling edge of `isStreaming`. The
 * composer is not permanently mounted — `ComposerSlot` swaps it out for the
 * `ask_user_question` and tool-approval cards, and switching chat tabs unmounts
 * it outright — so a turn that ends while it is away leaves no edge for it to
 * witness on the way back. Waiting for the next one strands the queue for good,
 * because the turn it is waiting on is the one it was supposed to start.
 *
 * `holdReason` is what says a queue must not drain on its own, and both paths
 * that mean it set it: a stop, and a send that genuinely failed. Together with
 * the `block` behavior that is the whole of "leave this alone", so an idle agent
 * and a sendable head need no further permission. A send the composer merely
 * turned away sets nothing — the entry goes back on the queue, which is a change
 * this effect re-reads, so it is re-attempted as soon as `canSend` allows.
 *
 * Sending the head raises `isStreaming` again, so the next entry waits for that
 * turn in its own right. Ordering stays FIFO, each queued message gets its own
 * turn, and a send that fails leaves the remainder queued and visible.
 *
 * That one message per turn is not structural — it holds because `isStreaming`
 * describes the turn this send just started by the time `submit` resolves, which
 * is what `submitMutation` in `agent-turns.ts` awaits its session refetch for.
 * Reading a pre-submit snapshot there would send the rest of the queue into the
 * running turn, so that await is load-bearing and says so at its own call site.
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
	/** Sends one entry the queue handed over, putting it back itself when it does not go. */
	submit: (entry: QueuedFollowUp) => Promise<void>;
}): void {
	// State rather than a ref: clearing it is what reconsiders the rest of the
	// queue. A ref re-renders nothing, so the next entry would wait on whatever
	// unrelated state happened to change next.
	const [flushing, setFlushing] = useState(false);

	useEffect(() => {
		if (isStreaming || flushing || !canSend) {
			return;
		}
		if (!hasSendableHead(queue, behavior)) {
			return;
		}
		const next = queue.takeNext();
		if (!next) {
			return;
		}
		setFlushing(true);
		void submit(next).finally(() => setFlushing(false));
	}, [behavior, canSend, flushing, isStreaming, queue, submit]);
}
