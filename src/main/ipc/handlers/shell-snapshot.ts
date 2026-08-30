import { app, BrowserWindow, ipcMain } from 'electron';

import {
	type AppLanguage,
	FALLBACK_LANGUAGE,
	resolveLanguage,
} from '../../../shared/i18n';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type { HealthSnapshot } from '../../../shared/ipc/contracts/health';
import type { RepositoryWorkspaceNavigationSnapshot } from '../../../shared/ipc/contracts/repository-navigation';
import type { InitialShellSnapshot } from '../../../shared/ipc/contracts/shell-snapshot';
import type { WindowChromeSnapshot } from '../../../shared/window-chrome';
import type { AppSettingsService, EnsemblrConfigService } from '../../config';
import type { OpenTargetService } from '../../open-target';
import type { EnsemblrDatabaseService } from '../../storage';
import { getRepositoryWorkspaceNavigationSnapshot } from '../repository-workspace-navigation';
import { buildHealthSnapshot } from './health';

/**
 * Registers the synchronous `initial-shell-snapshot` IPC channel consumed by
 * the preload bootstrap. Each underlying snapshot is built defensively so the
 * sync channel never throws — partial null fields are preferred over crashing
 * the preload bridge.
 */
export function registerShellSnapshotHandlers({
	appSettingsService,
	configService,
	databaseService,
	openTargetService,
	readWindowChrome,
}: {
	appSettingsService: AppSettingsService;
	configService: EnsemblrConfigService;
	databaseService: EnsemblrDatabaseService;
	openTargetService: OpenTargetService;
	/** The chrome the running window was constructed with, not the current setting. */
	readWindowChrome: () => WindowChromeSnapshot;
}): void {
	ipcMain.on(IPC_CHANNELS.initialShellSnapshot, (event) => {
		const snapshot: InitialShellSnapshot = {
			capturedAt: new Date().toISOString(),
			health: safeBuildHealthSnapshot(configService, databaseService),
			language: safeResolveLanguage(appSettingsService),
			maximized: isSenderWindowMaximized(event.sender),
			navigation: safeBuildNavigationSnapshot(databaseService),
			openTargets: openTargetService.getCachedSnapshots(),
			windowChrome: readWindowChrome(),
		};
		event.returnValue = snapshot;
	});
}

/**
 * Report whether the window behind the bootstrap request is maximized, so the
 * app-drawn control starts from the truth rather than from `false`. A reload of
 * an already-maximized window would otherwise show "Maximize" until the next
 * state change produced a broadcast.
 * @param sender - The web contents that issued the bootstrap request
 * @returns True when the window is maximized; false when it is gone or torn down
 */
function isSenderWindowMaximized(sender: Electron.WebContents): boolean {
	const window = BrowserWindow.fromWebContents(sender);
	return window !== null && !window.isDestroyed() && window.isMaximized();
}

/**
 * Resolve the render language the same way the native menu does, so the
 * renderer's first paint matches the menu bar instead of flashing English.
 * @param appSettingsService - Reads the stored `general.language` preference
 * @returns The resolved language, falling back to English when the read throws
 */
function safeResolveLanguage(
	appSettingsService: AppSettingsService,
): AppLanguage {
	try {
		return resolveLanguage(
			appSettingsService.read().general.language,
			app.getPreferredSystemLanguages(),
		);
	} catch {
		return FALLBACK_LANGUAGE;
	}
}

/**
 * Build the health snapshot, swallowing errors so the shell snapshot still returns.
 * @param configService - Config service used to build the snapshot
 * @param databaseService - Database service used to build the snapshot
 * @returns The health snapshot, or null when building it throws
 */
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

/**
 * Build the repository/workspace navigation snapshot, returning null on failure.
 * @param databaseService - Database service used to read navigation state
 * @returns The navigation snapshot, or null when building it throws
 */
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
