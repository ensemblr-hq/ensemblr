import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	SettingsResolutionRequest,
	SettingsResolutionSnapshot,
} from '../../../shared/ipc/contracts/settings-resolution';
import type { EnsemblrConfigResolutionService } from '../../config';

/**
 * Registers the IPC handler that resolves the layered Ensemblr settings tree
 * (app-wide + optional repository scope) for the renderer.
 * @param options - Required services.
 */
export function registerSettingsHandlers({
	settingsResolutionService,
}: {
	settingsResolutionService: EnsemblrConfigResolutionService;
}): void {
	ipcMain.handle(
		IPC_CHANNELS.settingsResolution,
		(
			_event,
			request: SettingsResolutionRequest | undefined,
		): SettingsResolutionSnapshot => settingsResolutionService.resolve(request),
	);
}
