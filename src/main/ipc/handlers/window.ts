import { BrowserWindow, ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type { WindowMaximizedBroadcast } from '../../../shared/ipc/contracts/repository-navigation';
import { openExternalUrl } from '../../app/external-links';

const MAX_ENSURED_WINDOW_WIDTH = 2400;

/**
 * Registers IPC handlers that mutate the BrowserWindow on behalf of the
 * renderer — the app-drawn window controls, the "ensure-minimum-width" request,
 * the relaunch that applies a construct-time setting, and opening vetted
 * external URLs (remediation docs links) in the default browser.
 * @param options - The quit-guarded relaunch the settings surface asks for.
 */
export function registerWindowHandlers({
	requestRelaunch,
}: {
	requestRelaunch: () => void;
}): void {
	ipcMain.handle(IPC_CHANNELS.openExternal, (_event, url: unknown) =>
		openExternalUrl(url),
	);

	ipcMain.handle(
		IPC_CHANNELS.ensureWindowWidth,
		(event, minimumWidth: unknown) => {
			const requestedWidth =
				typeof minimumWidth === 'number' && Number.isFinite(minimumWidth)
					? Math.ceil(minimumWidth)
					: 0;

			if (requestedWidth <= 0) {
				return;
			}

			const window = liveWindow(event.sender);

			if (!window || window.isFullScreen()) {
				return;
			}

			const targetWidth = Math.min(requestedWidth, MAX_ENSURED_WINDOW_WIDTH);
			const [width, height] = window.getSize();

			if (width < targetWidth) {
				window.setSize(targetWidth, height);
			}
		},
	);

	// `close()` rather than `app.quit()`: the window's own `close` handler is
	// where the quit coordinator runs the "agents are still running"
	// confirmation, and bypassing it would kill running agents silently.
	ipcMain.handle(IPC_CHANNELS.closeWindow, (event) => {
		liveWindow(event.sender)?.close();
	});

	ipcMain.handle(IPC_CHANNELS.minimizeWindow, (event) => {
		liveWindow(event.sender)?.minimize();
	});

	// Returns nothing on purpose. `maximize()` is a request to the window
	// manager, so `isMaximized()` on the next line can still report the old value
	// on X11 and Wayland; the `maximize`/`unmaximize` broadcast below is the only
	// writer of the renderer's state.
	ipcMain.handle(IPC_CHANNELS.toggleMaximizeWindow, (event) => {
		const window = liveWindow(event.sender);

		if (!window) {
			return;
		}

		if (window.isMaximized()) {
			window.unmaximize();
		} else {
			window.maximize();
		}
	});

	ipcMain.handle(IPC_CHANNELS.relaunchApp, () => {
		requestRelaunch();
	});
}

/**
 * Pushes the window's maximized state to its renderer on every change, so an
 * app-drawn control reflects a compositor shortcut or a double-click on the
 * drag strip rather than only its own last click.
 * @param window - The window to observe and report to.
 */
export function trackWindowMaximizedState(window: BrowserWindow): void {
	const report = (): void => {
		if (window.isDestroyed() || window.webContents.isDestroyed()) {
			return;
		}
		window.webContents.send(IPC_CHANNELS.windowMaximizedChanged, {
			maximized: window.isMaximized(),
		} satisfies WindowMaximizedBroadcast);
	};

	window.on('maximize', report);
	window.on('unmaximize', report);
	window.on('enter-full-screen', report);
	window.on('leave-full-screen', report);
	window.webContents.on('did-finish-load', report);
}

/**
 * Resolves the window behind a request, skipping one already torn down.
 * @param sender - The web contents that issued the request.
 * @returns The live window, or null.
 */
function liveWindow(sender: Electron.WebContents): BrowserWindow | null {
	const window = BrowserWindow.fromWebContents(sender);
	return window && !window.isDestroyed() ? window : null;
}
