import type {
	AppSettings,
	AppSettingsChangedBroadcast,
	AppSettingsPatch,
	OpenAppConfigFileResult,
} from '@/shared/ipc/contracts/app-settings';

import { getEnsembleApi, getEnsembleApiOrNull } from './query-keys';

/** Reads the validated App settings from `config.json` (main process). */
export function getAppSettings(): Promise<AppSettings> {
	return getEnsembleApi().getAppSettings();
}

/** Applies a section-scoped patch, persisting it to `config.json`. */
export function updateAppSettings(
	patch: AppSettingsPatch,
): Promise<AppSettings> {
	return getEnsembleApi().updateAppSettings(patch);
}

/** Opens `config.json` in the user's editor (creating it if needed). */
export function openAppConfigFile(): Promise<OpenAppConfigFileResult> {
	return getEnsembleApi().openAppConfigFile();
}

/** Subscribes to external edits of `config.json`; returns an unsubscribe fn. */
export function subscribeAppSettingsChanged(
	listener: (event: AppSettingsChangedBroadcast) => void,
): () => void {
	const api = getEnsembleApiOrNull();
	if (!api) {
		return () => undefined;
	}
	return api.onAppSettingsChanged(listener);
}
