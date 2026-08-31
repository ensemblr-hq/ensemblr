import { atom, useAtom, useSetAtom, useStore } from 'jotai';
import { useCallback, useEffect } from 'react';

import type { QueuedFollowUpSource } from '@/renderer/types/workbench';

/** One queued composer auto-submit (commit & push, create PR, a failed turn re-sent…). */
export interface ComposerSubmitRequest {
	chatTabId: string;
	id: string;
	/**
	 * Who asked for this send, which decides how the follow-up queue treats it
	 * mid-turn: a `chore` was announced as handed over and always drains, a `user`
	 * send obeys the Follow-up behavior the way a typed message does.
	 */
	source: QueuedFollowUpSource;
	text: string;
}

/**
 * Queue of prompts that should be sent to a chat tab's agent without
 * passing through the textarea. Review surfaces (Checks panel) enqueue a fully
 * formed prompt; the mounted composer drains the queue straight into its submit
 * pipeline. Unlike {@link useComposerInsert}, these DO auto-submit — the Checks
 * panel hands routine git chores (commit, push, open PR) to the agent on a
 * single click rather than seeding an editable draft.
 *
 * A single global queue is safe: only the active chat tab mounts a composer
 * (see `conversation-content`), so there is never more than one consumer per
 * renderer, and Jotai stores are per-window. Each entry still names the tab it
 * was queued for, because the *identity* of that one consumer changes when the
 * user switches tabs — a chore held for a busy tab must not land in whichever
 * tab happens to be mounted when it finally drains.
 */
const composerSubmitQueueAtom = atom<ComposerSubmitRequest[]>([]);

/**
 * Returns a stable callback that queues a prompt against a named chat tab.
 *
 * The target is the caller's to resolve, never inferred from whichever tab is in
 * front: the tab strip carries file, diff, and terminal tabs alongside chats,
 * and only a chat tab mounts a composer to drain the entry. Callers that fire
 * from a review surface resolve theirs with `resolveTargetChatTabId`.
 * @returns Callback taking the target tab, the prompt text, and its source
 */
export function useComposerSubmit(): (input: {
	chatTabId: string;
	source?: QueuedFollowUpSource;
	text: string;
}) => void {
	const setQueue = useSetAtom(composerSubmitQueueAtom);
	return useCallback(
		({ chatTabId, source = 'chore', text }) => {
			setQueue((queue) => [
				...queue,
				{ chatTabId, id: crypto.randomUUID(), source, text },
			]);
		},
		[setQueue],
	);
}

/**
 * Returns a callback that discards every queued prompt aimed at a chat tab.
 *
 * Entries only drain through the tab they name, so one left behind for a tab
 * that is closing could never be delivered — it would sit in the queue for the
 * life of the window while the user believes the chore was handed over. The
 * count lets the close path say so out loud.
 * @returns Callback taking the tab id and returning how many prompts it discarded
 */
export function useDropComposerSubmits(): (chatTabId: string) => number {
	const store = useStore();
	return useCallback(
		(chatTabId: string) => {
			const queue = store.get(composerSubmitQueueAtom);
			const kept = queue.filter((request) => request.chatTabId !== chatTabId);
			if (kept.length === queue.length) {
				return 0;
			}
			store.set(composerSubmitQueueAtom, kept);
			return queue.length - kept.length;
		},
		[store],
	);
}

/**
 * Drains this tab's queued prompts into its composer via the `submit` pipeline.
 *
 * `submit` returns `false` when it could not deliver right now — the composer is
 * disabled, a send is already in flight, or a mid-turn send is blocked by the
 * Follow-up setting. Rejected requests stay queued and retry automatically when
 * `submit`'s identity changes (it closes over the composer's state), so an
 * auto-submit chore is held until the composer is free rather than being
 * silently dropped. Entries queued for another tab are left for that tab.
 * @param chatTabId - Tab whose entries this consumer may drain
 * @param submit - The composer's send pipeline; returns whether it accepted
 */
export function useComposerSubmitConsumer(
	chatTabId: string,
	submit: (text: string, source: QueuedFollowUpSource) => boolean,
): void {
	const [queue, setQueue] = useAtom(composerSubmitQueueAtom);

	useEffect(() => {
		if (queue.length === 0) {
			return;
		}
		const undelivered = queue.filter(
			(request) =>
				request.chatTabId !== chatTabId ||
				!submit(request.text, request.source),
		);
		// Only rewrite the queue when at least one request was delivered. Writing
		// an equal-length array would be a new reference and re-trigger this effect
		// in a loop; leaving the queue untouched lets the retry happen when
		// `submit` (and thus this effect) is recreated by a composer state change.
		if (undelivered.length !== queue.length) {
			setQueue(undelivered);
		}
	}, [chatTabId, submit, queue, setQueue]);
}
