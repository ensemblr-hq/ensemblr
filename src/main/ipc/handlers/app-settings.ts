import { ipcMain } from 'electron';

import {
	type AppSettings,
	appSettingsPatchSchema,
} from '../../../shared/config/app-settings.ts';
import { IPC_CHANNELS } from '../../../shared/ipc/channels.ts';
import type { OpenAppConfigFileResult } from '../../../shared/ipc/contracts/app-settings.ts';
import type { AppSettingsService } from '../../config';
import { openInEditor } from '../../config/open-in-editor.ts';

/** Service dependencies for the app-settings IPC handlers. */
interface AppSettingsHandlersOptions {
	appSettingsService: AppSettingsService;
	/** Invoked after a successful write so main-process side-effects re-read. */
	onAppSettingsUpdated?: () => void;
}

/**
 * Registers read/write/open handlers for the App-settings slice of
 * `config.json`. Writes validate the incoming patch at the boundary; the
 * external-edit broadcast is wired separately in `main.ts`.
 */
export function registerAppSettingsHandlers({
	appSettingsService,
	onAppSettingsUpdated,
}: AppSettingsHandlersOptions): void {
	ipcMain.handle(
		IPC_CHANNELS.getAppSettings,
		(): AppSettings => appSettingsService.read(),
	);

	ipcMain.handle(
		IPC_CHANNELS.updateAppSettings,
		(_event, raw: unknown): AppSettings => {
			const settings = appSettingsService.update(
				appSettingsPatchSchema.parse(raw),
			);
			onAppSettingsUpdated?.();
			return settings;
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.openAppConfigFile,
		async (): Promise<OpenAppConfigFileResult> => {
			appSettingsService.ensureExists();
			return openInEditor(appSettingsService.getPath());
		},
	);
}
