import type { AppSettings, AppSettingsPatch } from '../../config/app-settings';

export type { AppSettings, AppSettingsPatch };

/** Pushed to the renderer when `config.json` changes on disk (external edits). */
export interface AppSettingsChangedBroadcast {
	settings: AppSettings;
}

/** Result of requesting `config.json` be opened in the user's editor. */
export interface OpenAppConfigFileResult {
	error?: string;
}

/**
 * App-settings IPC surface. `config.json` (`~/.config/ensemble/config.json`) is
 * the source of truth; the renderer reads on launch, writes section-scoped
 * patches, and live-reloads via {@link AppSettingsApi.onAppSettingsChanged}.
 */
export interface AppSettingsApi {
	getAppSettings: () => Promise<AppSettings>;
	updateAppSettings: (patch: AppSettingsPatch) => Promise<AppSettings>;
	openAppConfigFile: () => Promise<OpenAppConfigFileResult>;
	onAppSettingsChanged: (
		listener: (event: AppSettingsChangedBroadcast) => void,
	) => () => void;
}
