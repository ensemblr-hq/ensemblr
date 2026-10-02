import { app, BrowserWindow, Notification, powerSaveBlocker } from 'electron';

import { IPC_CHANNELS } from '../../shared/ipc/channels.ts';
import type {
	ChatTurnFinishedBroadcast,
	FocusChatBroadcast,
} from '../../shared/ipc/contracts/notifications.ts';
import type {
	AgentNotification,
	NotificationFocusTarget,
	PowerSaveControls,
} from './agent-activity-monitor.ts';
import { createNotificationRetainer } from './notification-retention.ts';

/**
 * Holds every shown notification so a click minutes later still reaches its
 * handler; see {@link createNotificationRetainer} for why the reference matters.
 */
const notificationRetainer = createNotificationRetainer();

/** Electron `powerSaveBlocker` adapter for the activity monitor. */
export const electronPowerControls: PowerSaveControls = {
	/** Starts an Electron power-save blocker of the given type. */
	start: (type) => powerSaveBlocker.start(type),
	/** Stops the Electron power-save blocker with the given id. */
	stop: (id) => powerSaveBlocker.stop(id),
};

/**
 * Raises the app from wherever it is and asks every window to open whatever the
 * notification was about — a chat in some workspace, or the Concierge panel.
 *
 * `window.focus()` alone is not enough on macOS: it raises the window within
 * Ensemblr but leaves whichever app the user is actually in frontmost, so the
 * chat opens behind their editor. `app.focus({ steal: true })` is what brings
 * Ensemblr forward.
 * @param target - The surface the clicked notification described.
 */
function openFromNotification(target: NotificationFocusTarget): void {
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
		if (target.kind === 'concierge') {
			window.webContents.send(IPC_CHANNELS.focusConciergeRequested);
		} else {
			window.webContents.send(IPC_CHANNELS.focusChatRequested, chatOf(target));
		}
	}
}

/**
 * Strips the discriminant back off a chat target, so the renderer receives the
 * broadcast shape its contract describes rather than one carrying a tag that
 * only mattered inside main.
 * @param target - The clicked notification's chat target.
 * @returns The focus broadcast for that chat.
 */
function chatOf(
	target: { kind: 'chat' } & FocusChatBroadcast,
): FocusChatBroadcast {
	return {
		agentSessionId: target.agentSessionId,
		chatTabId: target.chatTabId,
		workspaceId: target.workspaceId,
	};
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
 * another one. A Concierge notification is titled with the Concierge's own name
 * and opens its panel instead.
 *
 * The shown notification is handed to the retainer before it is displayed:
 * Electron drops a collected notification out of Notification Center along with
 * its click handler, and a background turn is precisely the one the user gets
 * back to late.
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
	shown.on('click', () => openFromNotification(notification.target));
	notificationRetainer.retain(shown);
	shown.show();
	if (notification.playSound) {
		requestNotificationSound();
	}
}

/**
 * Tells every window that a top-level chat finished a turn, so the renderer can
 * mark it unread. Sent to all of them rather than the focused one: the mark is
 * app-wide state and the chat routinely lives in a workspace no window shows.
 * @param broadcast - The chat that finished and when.
 */
export function electronAnnounceTurnFinished(
	broadcast: ChatTurnFinishedBroadcast,
): void {
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) {
			window.webContents.send(IPC_CHANNELS.chatTurnFinished, broadcast);
		}
	}
}

/** True when any non-destroyed app window currently has focus. */
export function electronIsAppFocused(): boolean {
	return BrowserWindow.getAllWindows().some(
		(window) => !window.isDestroyed() && window.isFocused(),
	);
}
