import type {
	ActiveChatContext,
	FocusChatBroadcast,
} from '@/shared/ipc/contracts/notifications';

import { getEnsemblrApiOrNull } from './query-keys';

/**
 * Tells the main process which chat is on screen, so a desktop notification is
 * suppressed for that chat alone rather than for the whole app. Fire-and-forget:
 * a dropped report only costs one redundant notification.
 * @param context - The chat on screen, or null when none is open.
 */
export function reportActiveChat(context: ActiveChatContext | null): void {
	void getEnsemblrApiOrNull()?.reportActiveChat(context);
}

/**
 * Subscribes to notification clicks so the renderer can open the chat the user
 * clicked through to. Returns an unsubscribe fn.
 * @param listener - Receives the chat to open.
 * @returns The unsubscribe function.
 */
export function subscribeFocusChatRequests(
	listener: (payload: FocusChatBroadcast) => void,
): () => void {
	const api = getEnsemblrApiOrNull();
	if (!api) {
		return () => undefined;
	}
	return api.onFocusChatRequested(listener);
}
