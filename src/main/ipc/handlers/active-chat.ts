import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type { ActiveChatStore } from '../../agent-runtime/active-chat-store.ts';
import { activeChatContextSchema } from '../request-schemas.ts';

/**
 * Registers the channel the renderer reports the chat on screen on, which is
 * what lets the desktop notifier suppress a notification for that one chat
 * instead of for the whole app.
 * @param activeChatStore - Holds the last reported chat
 */
export function registerActiveChatHandlers({
	activeChatStore,
}: {
	activeChatStore: ActiveChatStore;
}): void {
	ipcMain.handle(IPC_CHANNELS.activeChatContext, (_event, raw: unknown) => {
		const parsed = activeChatContextSchema.safeParse(raw);

		if (!parsed.success) {
			// Keeping the previous chat would silence notifications for a chat the
			// user has since left, so an unreadable report clears it instead.
			console.warn(
				'Rejected malformed active-chat report; treating no chat as on screen:',
				parsed.error.issues,
			);
			activeChatStore.apply(null);
			return;
		}

		activeChatStore.apply(parsed.data);
	});
}
