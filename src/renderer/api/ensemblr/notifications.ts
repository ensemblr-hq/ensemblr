import type {
	ActiveChatContext,
	ChatTurnFinishedBroadcast,
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

/**
 * Subscribes to finished top-level turns, which is what the unread list is
 * marked from. Main has already dropped a sub-agent's chat and a turn the user
 * stopped — neither is visible from the renderer's session-event stream.
 * Returns an unsubscribe fn.
 * @param listener - Receives the chat that finished.
 * @returns The unsubscribe function.
 */
export function subscribeChatTurnFinished(
	listener: (payload: ChatTurnFinishedBroadcast) => void,
): () => void {
	const api = getEnsemblrApiOrNull();
	if (!api) {
		return () => undefined;
	}
	return api.onChatTurnFinished(listener);
}

/**
 * Subscribes to the main process's request to play the notification chime, sent
 * with a desktop notification it has already gated. Returns an unsubscribe fn.
 * @param listener - Runs once per notification that should be audible.
 * @returns The unsubscribe function.
 */
export function subscribeNotificationSoundRequests(
	listener: () => void,
): () => void {
	const api = getEnsemblrApiOrNull();
	if (!api) {
		return () => undefined;
	}
	return api.onNotificationSoundRequested(listener);
}
