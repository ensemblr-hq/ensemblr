import { atom, useAtom, useSetAtom } from 'jotai';
import { useCallback, useEffect } from 'react';

/** One queued composer auto-submit (commit & push, create PR…). */
export interface ComposerSubmitRequest {
	id: string;
	text: string;
}

/**
 * Queue of prompts that should be sent to the active chat tab's agent without
 * passing through the textarea. Review surfaces (Checks panel) enqueue a fully
 * formed prompt; the mounted composer drains the queue straight into its submit
 * pipeline. Unlike {@link useComposerInsert}, these DO auto-submit — the Checks
 * panel hands routine git chores (commit, push, open PR) to the agent on a
 * single click rather than seeding an editable draft.
 *
 * A single global queue is safe: only the active chat tab mounts a composer
 * (see `conversation-content`), so there is never more than one consumer per
 * renderer, and Jotai stores are per-window.
 */
const composerSubmitQueueAtom = atom<ComposerSubmitRequest[]>([]);

/** Returns a stable callback that queues a prompt for the active composer. */
export function useComposerSubmit(): (text: string) => void {
	const setQueue = useSetAtom(composerSubmitQueueAtom);
	return useCallback(
		(text: string) => {
			setQueue((queue) => [...queue, { id: crypto.randomUUID(), text }]);
		},
		[setQueue],
	);
}

/**
 * Drains queued prompts into the active composer via its `submit` pipeline.
 *
 * `submit` returns `false` when it could not deliver right now — the composer is
 * disabled, a send is already in flight, or a mid-turn send is blocked by the
 * Follow-up setting. Rejected requests stay queued and retry automatically when
 * `submit`'s identity changes (it closes over the composer's state), so an
 * auto-submit chore is held until the composer is free rather than being
 * silently dropped.
 */
export function useComposerSubmitConsumer(
	submit: (text: string) => boolean,
): void {
	const [queue, setQueue] = useAtom(composerSubmitQueueAtom);

	useEffect(() => {
		if (queue.length === 0) {
			return;
		}
		const undelivered = queue.filter((request) => !submit(request.text));
		// Only rewrite the queue when at least one request was delivered. Writing
		// an equal-length array would be a new reference and re-trigger this effect
		// in a loop; leaving the queue untouched lets the retry happen when
		// `submit` (and thus this effect) is recreated by a composer state change.
		if (undelivered.length !== queue.length) {
			setQueue(undelivered);
		}
	}, [submit, queue, setQueue]);
}
