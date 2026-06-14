import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import { type SettingsResolutionRequest, type SettingsResolutionSnapshot } from '../../../shared/ipc/contracts/settings-resolution';
import type { EnsembleConfigResolutionService } from '../../config';

/** Service dependencies used by the settings-resolution IPC handlers. */
export interface SettingsHandlersOptions {
	settingsResolutionService: EnsembleConfigResolutionService;
}

/**
 * Registers the IPC handler that resolves the layered Ensemble settings tree
 * (app-wide + optional repository scope) for the renderer.
 * @param options - Required services.
 */
export function registerSettingsHandlers({
	settingsResolutionService,
}: SettingsHandlersOptions): void {
	ipcMain.handle(
		IPC_CHANNELS.settingsResolution,
		(
			_event,
			request: SettingsResolutionRequest | undefined,
		): SettingsResolutionSnapshot => settingsResolutionService.resolve(request),
	);
}
