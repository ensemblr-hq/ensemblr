import { atom, useAtom, useSetAtom, useStore } from 'jotai';
import { useCallback, useEffect } from 'react';
import { composerValueAtomFamily } from './composer-drafts';

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

/**
 * Appends `text` onto a specific chat's composer draft, keyed by chat-tab id,
 * regardless of which tab is active. Used by the diff viewer's "Add to chat"
 * picker so the diff lands in the chat the user chose rather than whichever
 * composer happens to be mounted. Blank-line-separates from any existing draft.
 * @returns A stable callback taking the target chat-tab id and the text to append
 */
export function useComposerInsertToChat(): (
	chatTabId: string,
	text: string,
) => void {
	const store = useStore();
	return useCallback(
		(chatTabId: string, text: string) => {
			store.set(composerValueAtomFamily(chatTabId), (current) =>
				current.trim().length > 0 ? `${current.trimEnd()}\n\n${text}` : text,
			);
		},
		[store],
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
