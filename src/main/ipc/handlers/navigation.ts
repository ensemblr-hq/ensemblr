import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type { RepositoryWorkspaceNavigationSnapshot } from '../../../shared/ipc/contracts/repository-navigation';
import type { EnsemblrDatabaseService } from '../../storage';
import { getRepositoryWorkspaceNavigationSnapshot } from '../repository-workspace-navigation';

/** Service dependencies used by the navigation-snapshot IPC handlers. */
export interface NavigationHandlersOptions {
	databaseService: EnsemblrDatabaseService;
}

/**
 * Registers the IPC handler that serves the repository/workspace navigation
 * snapshot consumed by the renderer's sidebar.
 * @param options - Required services.
 */
export function registerNavigationHandlers({
	databaseService,
}: NavigationHandlersOptions): void {
	ipcMain.handle(
		IPC_CHANNELS.repositoryWorkspaceNavigation,
		(): RepositoryWorkspaceNavigationSnapshot =>
			getRepositoryWorkspaceNavigationSnapshot(
				databaseService.getConnection()?.database ?? null,
			),
	);
}
