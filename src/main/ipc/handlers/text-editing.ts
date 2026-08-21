import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import {
	addWordToDictionaryRequestSchema,
	replaceMisspellingRequestSchema,
	textEditCommandSchema,
} from '../request-schemas';

/**
 * Registers the handlers behind the renderer's text context menu: the clipboard
 * and history commands, plus the two spellchecker operations.
 *
 * Each runs against the web contents that asked for it, on whatever that frame
 * has focused, so the calling surface is responsible for putting focus back on
 * its field before invoking.
 */
export function registerTextEditingHandlers(): void {
	ipcMain.handle(IPC_CHANNELS.runTextEditCommand, (event, command: unknown) => {
		const parsed = textEditCommandSchema.parse(command);

		if (event.sender.isDestroyed()) {
			return;
		}

		event.sender[parsed]();
	});

	ipcMain.handle(IPC_CHANNELS.replaceMisspelling, (event, request: unknown) => {
		const { replacement } = replaceMisspellingRequestSchema.parse(request);

		if (event.sender.isDestroyed()) {
			return;
		}

		event.sender.replaceMisspelling(replacement);
	});

	ipcMain.handle(
		IPC_CHANNELS.addWordToDictionary,
		(event, request: unknown) => {
			const { word } = addWordToDictionaryRequestSchema.parse(request);

			if (event.sender.isDestroyed()) {
				return;
			}

			event.sender.session.addWordToSpellCheckerDictionary(word);
		},
	);
}
