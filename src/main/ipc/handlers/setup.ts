import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type { SetupDiagnosticsSnapshot } from '../../../shared/ipc/contracts/setup';
import type { SetupDiagnosticsService } from '../../setup';

/**
 * Registers IPC handlers for the setup-diagnostics snapshot.
 * @param options - Required services.
 */
export function registerSetupHandlers({
	setupDiagnosticsService,
}: {
	setupDiagnosticsService: SetupDiagnosticsService;
}): void {
	ipcMain.handle(
		IPC_CHANNELS.setupDiagnostics,
		(): Promise<SetupDiagnosticsSnapshot> => {
			return setupDiagnosticsService.getSnapshot();
		},
	);
}
