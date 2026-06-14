import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import { type ListPiSlashCommandsRequest, type ListPiSlashCommandsResult, type PiExecutableSelectionResult } from '../../../shared/ipc/contracts/pi-session';
import { resolvePiSlashCommands } from '../../pi-agent/pi-slash-commands.ts';
import type { PiExecutableService } from '../../pi-runtime';
import { showDirectorySelectionDialog } from './dialog-helpers.ts';

/** Service dependencies used by the Pi executable IPC handlers. */
export interface PiHandlersOptions {
	piExecutableService: PiExecutableService;
}

/**
 * Registers IPC handlers for selecting and saving a Pi executable override
 * and for surfacing pi's slash command catalog to the renderer.
 * @param options - Required services.
 */
export function registerPiHandlers({
	piExecutableService,
}: PiHandlersOptions): void {
	ipcMain.handle(
		IPC_CHANNELS.selectPiExecutable,
		async (event): Promise<PiExecutableSelectionResult> => {
			const selection = await showDirectorySelectionDialog(event, {
				buttonLabel: 'Select Pi executable',
				message:
					'Select a Pi-compatible executable or wrapper script, such as pi or oh-my-pi.',
				properties: ['openFile'],
				title: 'Select Pi executable',
			});

			if (selection.canceled) {
				return { canceled: true };
			}

			return piExecutableService.saveOverride(selection.path);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.listPiSlashCommands,
		async (
			_event,
			request?: ListPiSlashCommandsRequest,
		): Promise<ListPiSlashCommandsResult> => {
			const snapshot = await piExecutableService.getSnapshot();
			return resolvePiSlashCommands(snapshot, request?.cwd);
		},
	);
}
