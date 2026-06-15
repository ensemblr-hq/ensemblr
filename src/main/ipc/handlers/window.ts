import { BrowserWindow, ipcMain, shell } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';

const MAX_ENSURED_WINDOW_WIDTH = 2400;

/** URL schemes the renderer may open in the default browser. */
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Registers IPC handlers that mutate the BrowserWindow on behalf of the
 * renderer — the "ensure-minimum-width" request and opening vetted external
 * URLs (remediation docs links) in the default browser.
 */
export function registerWindowHandlers(): void {
	ipcMain.handle(IPC_CHANNELS.openExternal, async (_event, url: unknown) => {
		if (typeof url !== 'string') {
			console.warn('[window] openExternal ignored non-string url', typeof url);
			return;
		}

		let parsed: URL;

		try {
			parsed = new URL(url);
		} catch {
			console.warn('[window] openExternal ignored unparseable url', url);
			return;
		}

		if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
			console.warn(
				'[window] openExternal blocked disallowed protocol',
				parsed.protocol,
			);
			return;
		}

		try {
			await shell.openExternal(parsed.toString());
		} catch (error) {
			console.error('[window] openExternal failed', error);
		}
	});

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
}
