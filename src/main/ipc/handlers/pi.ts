import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron';

import {
	IPC_CHANNELS,
	type PiExecutableSelectionResult,
} from '../../../shared/ipc';
import type { PiExecutableService } from '../../pi';

/** Service dependencies used by the Pi executable IPC handlers. */
export interface PiHandlersOptions {
	piExecutableService: PiExecutableService;
}

/**
 * Registers IPC handlers for selecting and saving a Pi executable override.
 * @param options - Required services.
 */
export function registerPiHandlers({
	piExecutableService,
}: PiHandlersOptions): void {
	ipcMain.handle(
		IPC_CHANNELS.selectPiExecutable,
		async (event): Promise<PiExecutableSelectionResult> => {
			const window = BrowserWindow.fromWebContents(event.sender);
			const options: OpenDialogOptions = {
				buttonLabel: 'Select Pi executable',
				message:
					'Select a Pi-compatible executable or wrapper script, such as pi or oh-my-pi.',
				properties: ['openFile'],
				title: 'Select Pi executable',
			};
			const result = window
				? await dialog.showOpenDialog(window, options)
				: await dialog.showOpenDialog(options);

			if (result.canceled || !result.filePaths[0]) {
				return { canceled: true };
			}

			return piExecutableService.saveOverride(result.filePaths[0]);
		},
	);
}
