import { atom, useAtom, useSetAtom } from 'jotai';
import { useCallback, useEffect } from 'react';

/** A pending request to focus a specific chat's composer, tagged for de-dup. */
interface ComposerFocusRequest {
	chatTabId: string;
	requestId: number;
}

/**
 * The chat whose composer should grab focus next, or null when none is pending.
 * A surface that routes the user to a chat (the diff viewer's "Add to chat")
 * sets it; the composer that mounts for that tab consumes and clears it. The
 * incrementing `requestId` makes back-to-back requests for the same tab distinct
 * so the consuming effect re-fires.
 */
const composerFocusRequestAtom = atom<ComposerFocusRequest | null>(null);

/** Returns a stable callback that queues a focus request for a chat's composer. */
export function useRequestComposerFocus(): (chatTabId: string) => void {
	const setRequest = useSetAtom(composerFocusRequestAtom);
	return useCallback(
		(chatTabId: string) => {
			setRequest((current) => ({
				chatTabId,
				requestId: (current?.requestId ?? 0) + 1,
			}));
		},
		[setRequest],
	);
}

/**
 * Focus the mounted composer when a pending request targets its chat tab, then
 * clear the request so it fires once. Called by the composer panel.
 * @param chatTabId - The chat tab the calling composer belongs to
 * @param focus - Callback that focuses the composer's textarea
 */
export function useConsumeComposerFocusRequest(
	chatTabId: string,
	focus: () => void,
): void {
	const [request, setRequest] = useAtom(composerFocusRequestAtom);

	useEffect(() => {
		if (request?.chatTabId !== chatTabId) {
			return;
		}
		focus();
		setRequest(null);
	}, [request, chatTabId, focus, setRequest]);
}
