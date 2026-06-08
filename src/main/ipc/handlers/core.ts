import { app, BrowserWindow, ipcMain } from 'electron';

import {
	type EnvironmentVariablesSnapshot,
	type HealthSnapshot,
	type InitialShellSnapshot,
	IPC_CHANNELS,
	type RepositoryWorkspaceNavigationSnapshot,
	type SettingsResolutionSnapshot,
} from '../../../shared/ipc';
import type {
	EnsembleConfigResolutionService,
	EnsembleConfigService,
} from '../../config';
import type { EnvironmentVariablesService } from '../../environment';
import type { EnsembleDatabaseService } from '../../storage';
import { getRepositoryWorkspaceNavigationSnapshot } from '../repository-workspace-navigation';

const MAX_ENSURED_WINDOW_WIDTH = 2400;

/** Service dependencies used by the cross-cutting "core" IPC handlers. */
export interface CoreHandlersOptions {
	configService: EnsembleConfigService;
	databaseService: EnsembleDatabaseService;
	environmentVariablesService: EnvironmentVariablesService;
	settingsResolutionService: EnsembleConfigResolutionService;
}

/**
 * Registers cross-cutting IPC handlers — window sizing, environment
 * variables, health, settings resolution, and the initial shell snapshot.
 * @param options - Required services.
 */
export function registerCoreHandlers({
	configService,
	databaseService,
	environmentVariablesService,
	settingsResolutionService,
}: CoreHandlersOptions): void {
	ipcMain.handle(
		IPC_CHANNELS.ensureWindowWidth,
		(event, minimumWidth: unknown) => {
			const requestedWidth =
				typeof minimumWidth === 'number' && Number.isFinite(minimumWidth)
					? Math.ceil(minimumWidth)
					: 0;

			if (requestedWidth <= 0) {
				return;
			}

			const window = BrowserWindow.fromWebContents(event.sender);

			if (!window || window.isDestroyed() || window.isFullScreen()) {
				return;
			}

			const targetWidth = Math.min(requestedWidth, MAX_ENSURED_WINDOW_WIDTH);
			const [width, height] = window.getSize();

			if (width < targetWidth) {
				window.setSize(targetWidth, height);
			}
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.environmentVariables,
		(): Promise<EnvironmentVariablesSnapshot> => {
			return environmentVariablesService.getSnapshot();
		},
	);

	ipcMain.handle(IPC_CHANNELS.health, (): HealthSnapshot => {
		return buildHealthSnapshot(configService, databaseService);
	});

	ipcMain.on(IPC_CHANNELS.initialShellSnapshot, (event) => {
		const snapshot: InitialShellSnapshot = {
			capturedAt: new Date().toISOString(),
			health: safeBuildHealthSnapshot(configService, databaseService),
			navigation: safeBuildNavigationSnapshot(databaseService),
		};
		event.returnValue = snapshot;
	});

	ipcMain.handle(
		IPC_CHANNELS.repositoryWorkspaceNavigation,
		(): RepositoryWorkspaceNavigationSnapshot => {
			return getRepositoryWorkspaceNavigationSnapshot(
				databaseService.getConnection()?.database ?? null,
			);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.settingsResolution,
		(_event, request: unknown): SettingsResolutionSnapshot => {
			return settingsResolutionService.resolve(request);
		},
	);
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
