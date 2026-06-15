import { BrowserWindow, Notification, powerSaveBlocker } from 'electron';

import type { PowerSaveControls } from './agent-activity-monitor.ts';

/** Electron `powerSaveBlocker` adapter for the activity monitor. */
export const electronPowerControls: PowerSaveControls = {
	start: (type) => powerSaveBlocker.start(type),
	stop: (id) => powerSaveBlocker.stop(id),
};

/** Shows a desktop notification; clicking it focuses the main window. */
export function electronNotify(options: {
	title: string;
	body: string;
}): void {
	if (!Notification.isSupported()) {
		return;
	}
	const notification = new Notification(options);
	notification.on('click', () => {
		const [window] = BrowserWindow.getAllWindows();
		if (!window || window.isDestroyed()) {
			return;
		}
		if (window.isMinimized()) {
			window.restore();
		}
		window.focus();
	});
	notification.show();
}

/** True when any non-destroyed app window currently has focus. */
export function electronIsAppFocused(): boolean {
	return BrowserWindow.getAllWindows().some(
		(window) => !window.isDestroyed() && window.isFocused(),
	);
}
