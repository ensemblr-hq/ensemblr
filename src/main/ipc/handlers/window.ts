import { BrowserWindow, ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import { openExternalUrl } from '../../app/external-links';

const MAX_ENSURED_WINDOW_WIDTH = 2400;

/**
 * Registers IPC handlers that mutate the BrowserWindow on behalf of the
 * renderer — the "ensure-minimum-width" request and opening vetted external
 * URLs (remediation docs links) in the default browser.
 */
export function registerWindowHandlers(): void {
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

			const window = BrowserWindow.fromWebContents(event.sender);

			if (!window || window.isDestroyed() || window.isFullScreen()) {
				return;
			}

			const targetWidth = Math.min(requestedWidth, MAX_ENSURED_WINDOW_WIDTH);
			const [width, height] = window.getSize();

			if (width < targetWidth) {
				window.setSize(targetWidth, height);
			}
		},
	);

	ipcMain.handle(IPC_CHANNELS.closeWindow, (event) => {
		const window = BrowserWindow.fromWebContents(event.sender);

		if (window && !window.isDestroyed()) {
			window.close();
		}
	});
}
