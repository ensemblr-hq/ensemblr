import { app, ipcMain } from 'electron';

import { type HealthSnapshot } from '../../../shared/ipc/contracts/health';
import { type InitialShellSnapshot, type RepositoryWorkspaceNavigationSnapshot } from '../../../shared/ipc/contracts/repository-navigation';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type { EnsembleConfigService } from '../../config';
import type { OpenTargetService } from '../../open-target';
import type { EnsembleDatabaseService } from '../../storage';
import { getRepositoryWorkspaceNavigationSnapshot } from '../repository-workspace-navigation';

/** Service dependencies used by the health-snapshot IPC handlers. */
export interface HealthHandlersOptions {
	configService: EnsembleConfigService;
	databaseService: EnsembleDatabaseService;
	openTargetService: OpenTargetService;
}

/**
 * Registers IPC handlers for the async health snapshot and the synchronous
 * initial-shell snapshot used by the preload bootstrap.
 * @param options - Required services.
 */
export function registerHealthHandlers({
	configService,
	databaseService,
	openTargetService,
}: HealthHandlersOptions): void {
	ipcMain.handle(IPC_CHANNELS.health, (): HealthSnapshot => {
		return buildHealthSnapshot(configService, databaseService);
	});

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

/** Single source of truth for the health-snapshot shape returned by both channels. */
function buildHealthSnapshot(
	configService: EnsembleConfigService,
	databaseService: EnsembleDatabaseService,
): HealthSnapshot {
	return {
		appName: app.getName(),
		config: configService.getSnapshot(),
		database: databaseService.getHealth(),
		platform: process.platform,
		status: 'ok',
		timestamp: new Date().toISOString(),
		versions: {
			chrome: process.versions.chrome,
			electron: process.versions.electron,
			node: process.versions.node,
		},
	};
}

/** Builds a health snapshot, swallowing failures so the sync channel never throws. */
function safeBuildHealthSnapshot(
	configService: EnsembleConfigService,
	databaseService: EnsembleDatabaseService,
): HealthSnapshot | null {
	try {
		return buildHealthSnapshot(configService, databaseService);
	} catch {
		return null;
	}
}

/** Builds the navigation snapshot when SQLite is available; null otherwise. */
function safeBuildNavigationSnapshot(
	databaseService: EnsembleDatabaseService,
): RepositoryWorkspaceNavigationSnapshot | null {
	try {
		return getRepositoryWorkspaceNavigationSnapshot(
			databaseService.getConnection()?.database ?? null,
		);
	} catch {
		return null;
	}
}
