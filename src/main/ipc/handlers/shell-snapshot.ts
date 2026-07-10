import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type { HealthSnapshot } from '../../../shared/ipc/contracts/health';
import type { RepositoryWorkspaceNavigationSnapshot } from '../../../shared/ipc/contracts/repository-navigation';
import type { InitialShellSnapshot } from '../../../shared/ipc/contracts/shell-snapshot';
import type { EnsemblrConfigService } from '../../config';
import type { OpenTargetService } from '../../open-target';
import type { EnsemblrDatabaseService } from '../../storage';
import { getRepositoryWorkspaceNavigationSnapshot } from '../repository-workspace-navigation';
import { buildHealthSnapshot } from './health';

/** Service dependencies used by the synchronous initial-shell snapshot. */
export interface ShellSnapshotHandlersOptions {
	configService: EnsemblrConfigService;
	databaseService: EnsemblrDatabaseService;
	openTargetService: OpenTargetService;
}

/**
 * Registers the synchronous `initial-shell-snapshot` IPC channel consumed by
 * the preload bootstrap. Each underlying snapshot is built defensively so the
 * sync channel never throws — partial null fields are preferred over crashing
 * the preload bridge.
 */
export function registerShellSnapshotHandlers({
	configService,
	databaseService,
	openTargetService,
}: ShellSnapshotHandlersOptions): void {
	ipcMain.on(IPC_CHANNELS.initialShellSnapshot, (event) => {
		const snapshot: InitialShellSnapshot = {
			capturedAt: new Date().toISOString(),
			health: safeBuildHealthSnapshot(configService, databaseService),
			navigation: safeBuildNavigationSnapshot(databaseService),
			openTargets: openTargetService.getCachedSnapshots(),
		};
		event.returnValue = snapshot;
	});
}

function safeBuildHealthSnapshot(
	configService: EnsemblrConfigService,
	databaseService: EnsemblrDatabaseService,
): HealthSnapshot | null {
	try {
		return buildHealthSnapshot(configService, databaseService);
	} catch {
		return null;
	}
}

function safeBuildNavigationSnapshot(
	databaseService: EnsemblrDatabaseService,
): RepositoryWorkspaceNavigationSnapshot | null {
	try {
		return getRepositoryWorkspaceNavigationSnapshot(
			databaseService.getConnection()?.database ?? null,
		);
	} catch {
		return null;
	}
}
