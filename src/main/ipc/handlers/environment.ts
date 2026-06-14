import { ipcMain } from 'electron';

import { type EnvironmentVariablesSnapshot } from '../../../shared/ipc/contracts/environment';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type { EnvironmentVariablesService } from '../../environment';

/** Service dependencies used by the environment-variables IPC handler. */
export interface EnvironmentHandlersOptions {
	environmentVariablesService: EnvironmentVariablesService;
}

/**
 * Registers the IPC handler that exposes the curated environment variables
 * snapshot to the renderer.
 * @param options - Required services.
 */
export function registerEnvironmentHandlers({
	environmentVariablesService,
}: EnvironmentHandlersOptions): void {
	ipcMain.handle(
		IPC_CHANNELS.environmentVariables,
		(): Promise<EnvironmentVariablesSnapshot> =>
			environmentVariablesService.getSnapshot(),
	);
}
