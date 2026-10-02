import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type { UpdateStatusSnapshot } from '../../../shared/ipc/contracts/update';
import type { UpdateService } from '../../updates';

/**
 * Registers the in-app updater's IPC surface. All three ops take no payload —
 * what may be checked and what may be installed is decided by the service from
 * the running build, never by the renderer — so there is nothing to validate
 * beyond the channel names themselves.
 * @param options - The update service each op delegates to.
 */
export function registerUpdateHandlers({
	updateService,
}: {
	updateService: UpdateService;
}): void {
	ipcMain.handle(
		IPC_CHANNELS.updateStatus,
		(): UpdateStatusSnapshot => updateService.snapshot(),
	);
	ipcMain.handle(
		IPC_CHANNELS.checkForUpdates,
		(): Promise<UpdateStatusSnapshot> => updateService.checkNow(),
	);
	ipcMain.handle(
		IPC_CHANNELS.installUpdate,
		(): UpdateStatusSnapshot => updateService.install(),
	);
}
