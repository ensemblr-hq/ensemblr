import { queryOptions } from '@tanstack/react-query';

import type {
	AppSettings,
	AppSettingsChangedBroadcast,
	AppSettingsPatch,
	OpenAppConfigFileResult,
} from '@/shared/ipc/contracts/app-settings';

import {
	ensemblrQueryKeys,
	getEnsemblrApi,
	getEnsemblrApiOrNull,
} from './query-keys';

/**
 * First-run state as a query, for the caller that needs it *before* React runs:
 * the onboarding guard reads it in `beforeLoad`, where the Jotai mirror is still
 * holding defaults and would redirect on every cold start.
 *
 * Deliberately narrowed to the `onboarding` section rather than exposing all of
 * `AppSettings`. Nothing invalidates this cache — it is never stale, because the
 * wizard is the only writer and it seeds the result itself. Every other section
 * is live-edited from Settings and mirrored through
 * {@link subscribeAppSettingsChanged}, so serving it from here would hand out a
 * copy frozen at first read.
 */
export const onboardingStatusQuery = queryOptions({
	/** Reads the first-run section of App settings over the app-settings IPC channel. */
	queryFn: async () => (await getAppSettings()).onboarding,
	queryKey: ensemblrQueryKeys.onboardingStatus(),
	staleTime: Number.POSITIVE_INFINITY,
});

/** Reads the validated App settings from `config.json` (main process). */
export function getAppSettings(): Promise<AppSettings> {
	return getEnsemblrApi().getAppSettings();
}

/** Applies a section-scoped patch, persisting it to `config.json`. */
export function updateAppSettings(
	patch: AppSettingsPatch,
): Promise<AppSettings> {
	return getEnsemblrApi().updateAppSettings(patch);
}

/** Reads the OS language preference order (most-preferred first) from main. */
export function getSystemLanguages(): Promise<string[]> {
	return getEnsemblrApi().getSystemLanguages();
}

/** Opens `config.json` in the user's editor (creating it if needed). */
export function openAppConfigFile(): Promise<OpenAppConfigFileResult> {
	return getEnsemblrApi().openAppConfigFile();
}

/** Subscribes to external edits of `config.json`; returns an unsubscribe fn. */
export function subscribeAppSettingsChanged(
	listener: (event: AppSettingsChangedBroadcast) => void,
): () => void {
	const api = getEnsemblrApiOrNull();
	if (!api) {
		return () => undefined;
	}
	return api.onAppSettingsChanged(listener);
}
