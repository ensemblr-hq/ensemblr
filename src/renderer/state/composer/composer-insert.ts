import { atom, useAtom, useSetAtom } from 'jotai';
import { useCallback, useEffect } from 'react';

/** One queued composer insertion (review context, check failure, comment…). */
export interface ComposerInsertRequest {
	id: string;
	text: string;
}

/**
 * Queue of pending composer insertions. Review surfaces (Checks panel, diff
 * viewer) enqueue context blocks; the mounted composer drains the queue into
 * its textarea. Nothing auto-submits — the user always presses send (ENS-053).
 */
const composerInsertQueueAtom = atom<ComposerInsertRequest[]>([]);

/** Returns a stable callback that queues text for the workspace composer. */
export function useComposerInsert(): (text: string) => void {
	const setQueue = useSetAtom(composerInsertQueueAtom);
	return useCallback(
		(text: string) => {
			setQueue((queue) => [...queue, { id: crypto.randomUUID(), text }]);
		},
		[setQueue],
	);
}

/** Drains queued insertions into the active composer via `insertText`. */
export function useComposerInsertConsumer(
	insertText: (text: string) => void,
): void {
	const [queue, setQueue] = useAtom(composerInsertQueueAtom);

	useEffect(() => {
		if (queue.length === 0) {
			return;
		}
		for (const request of queue) {
			insertText(request.text);
		}
		setQueue([]);
	}, [insertText, queue, setQueue]);
}
