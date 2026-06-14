import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import { type SetupDiagnosticsSnapshot } from '../../../shared/ipc/contracts/setup';
import type { SetupDiagnosticsService } from '../../setup';

/** Service dependencies used by the setup-diagnostics IPC handlers. */
export interface SetupHandlersOptions {
	setupDiagnosticsService: SetupDiagnosticsService;
}

/**
 * Registers IPC handlers for the setup-diagnostics snapshot.
 * @param options - Required services.
 */
export function registerSetupHandlers({
	setupDiagnosticsService,
}: SetupHandlersOptions): void {
	ipcMain.handle(
		IPC_CHANNELS.setupDiagnostics,
		(): Promise<SetupDiagnosticsSnapshot> => {
			return setupDiagnosticsService.getSnapshot();
		},
	);
}
