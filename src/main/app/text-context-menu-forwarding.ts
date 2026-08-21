import type { ContextMenuParams, WebContents } from 'electron';

import { IPC_CHANNELS } from '../../shared/ipc/channels';
import type { TextContextMenuTarget } from '../../shared/ipc/contracts/text-editing';

/**
 * Rebuilds Chromium's report of a right-click as the payload the renderer draws
 * from, rescaling the click into the CSS pixels the renderer measures in.
 *
 * `params.x`/`params.y` arrive in device-independent pixels, because Blink has
 * already folded the page zoom into its layout coordinates by the time the
 * event leaves it. `document.elementFromPoint` and a `position: fixed` offset
 * both take CSS pixels, so the two agree only while the window sits at 100%.
 * @param params - What Chromium reported about the click
 * @param zoomFactor - The window's page zoom, as 1 per 100%
 * @returns The target payload the renderer opens its menu against
 */
export function toTextContextMenuTarget(
	params: ContextMenuParams,
	zoomFactor: number,
): TextContextMenuTarget {
	const scale = zoomFactor > 0 ? zoomFactor : 1;

	return {
		canCopy: params.editFlags.canCopy,
		canCut: params.editFlags.canCut,
		canPaste: params.editFlags.canPaste,
		canRedo: params.editFlags.canRedo,
		canSelectAll: params.editFlags.canSelectAll,
		canUndo: params.editFlags.canUndo,
		dictionarySuggestions: params.dictionarySuggestions,
		isEditable: params.isEditable,
		misspelledWord: params.misspelledWord,
		selectionText: params.selectionText,
		x: params.x / scale,
		y: params.y / scale,
	};
}

/**
 * Forwards every right-click to the renderer so it can draw the text context
 * menu in the app's own chrome.
 *
 * Chromium reports the spellchecker's verdict, the selection, and the edit
 * flags only through this event, and only while the page leaves the
 * `contextmenu` DOM event uncancelled — a renderer that calls `preventDefault`
 * suppresses the event and never learns any of it. So the renderer opens its
 * menu from this broadcast rather than from its own DOM handler, and Electron
 * draws no menu of its own to compete with.
 * @param webContents - The window's web contents to forward from
 */
export function forwardTextContextMenus(webContents: WebContents): void {
	webContents.on('context-menu', (_event, params) => {
		webContents.send(
			IPC_CHANNELS.textContextMenu,
			toTextContextMenuTarget(params, webContents.zoomFactor),
		);
	});
}
