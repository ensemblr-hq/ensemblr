import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type { ActiveChatStore } from '../../agent-runtime/active-chat-store.ts';
import {
	activeChatContextSchema,
	conciergeVisibilityReportSchema,
} from '../request-schemas.ts';

/**
 * Registers the two channels the renderer reports what the user is looking at
 * on — the chat on screen, and whether the Concierge panel is open over it —
 * which is what lets the desktop notifier suppress a notification for that one
 * surface instead of for the whole app.
 * @param activeChatStore - Holds the last reported chat and panel visibility
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

	ipcMain.handle(
		IPC_CHANNELS.reportConciergeVisibility,
		(_event, raw: unknown) => {
			const parsed = conciergeVisibilityReportSchema.safeParse(raw);

			if (!parsed.success) {
				// Same stance as above: an unreadable report reads as "the panel is not
				// in front of the user", which notifies rather than staying silent.
				console.warn(
					'Rejected malformed Concierge visibility report; treating the panel as closed:',
					parsed.error.issues,
				);
				activeChatStore.applyConciergeVisibility(false);
				return;
			}

			activeChatStore.applyConciergeVisibility(parsed.data.visible);
		},
	);
}
