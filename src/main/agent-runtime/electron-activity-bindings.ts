import { app, BrowserWindow, Notification, powerSaveBlocker } from 'electron';

import { IPC_CHANNELS } from '../../shared/ipc/channels.ts';
import type { FocusChatBroadcast } from '../../shared/ipc/contracts/notifications.ts';
import type {
	AgentNotification,
	PowerSaveControls,
} from './agent-activity-monitor.ts';

/** Electron `powerSaveBlocker` adapter for the activity monitor. */
export const electronPowerControls: PowerSaveControls = {
	/** Starts an Electron power-save blocker of the given type. */
	start: (type) => powerSaveBlocker.start(type),
	/** Stops the Electron power-save blocker with the given id. */
	stop: (id) => powerSaveBlocker.stop(id),
};

/**
 * Raises the app from wherever it is and asks every window to open the chat the
 * notification was about.
 *
 * `window.focus()` alone is not enough on macOS: it raises the window within
 * Ensemblr but leaves whichever app the user is actually in frontmost, so the
 * chat opens behind their editor. `app.focus({ steal: true })` is what brings
 * Ensemblr forward.
 * @param target - The chat the clicked notification described.
 */
function openChatFromNotification(target: FocusChatBroadcast): void {
	const windows = BrowserWindow.getAllWindows().filter(
		(window) => !window.isDestroyed(),
	);
	const [primary] = windows;
	if (primary) {
		if (primary.isMinimized()) {
			primary.restore();
		}
		primary.show();
		primary.focus();
	}
	app.focus({ steal: true });
	for (const window of windows) {
		window.webContents.send(IPC_CHANNELS.focusChatRequested, target);
	}
}

/**
 * Asks every window to play the app's notification chime. The audio lives in the
 * renderer because the main process cannot play an arbitrary sound file, so the
 * decision is made here and only the playback crosses the bridge.
 */
function requestNotificationSound(): void {
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) {
			window.webContents.send(IPC_CHANNELS.notificationSoundRequested);
		}
	}
}

/**
 * Shows a desktop notification titled with the chat that produced it; clicking
 * it raises the app and opens that chat, crossing workspaces when it lives in
 * another one.
 *
 * The notification is always `silent`: Ensemblr plays its own chime from the
 * renderer, and leaving macOS free to play its default tone would stack two
 * sounds on every notification. A user who switches the chime off wants
 * silence, not the system tone back.
 * @param notification - The rendered title and body plus the chat to open.
 */
export function electronNotify(notification: AgentNotification): void {
	if (!Notification.isSupported()) {
		return;
	}
	const shown = new Notification({
		body: notification.body,
		silent: true,
		title: notification.title,
	});
	shown.on('click', () => openChatFromNotification(notification.target));
	shown.show();
	if (notification.playSound) {
		requestNotificationSound();
	}
}

/** True when any non-destroyed app window currently has focus. */
export function electronIsAppFocused(): boolean {
	return BrowserWindow.getAllWindows().some(
		(window) => !window.isDestroyed() && window.isFocused(),
	);
}
