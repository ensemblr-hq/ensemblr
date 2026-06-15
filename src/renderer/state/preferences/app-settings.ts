import { atom, useSetAtom } from 'jotai';
import { useEffect } from 'react';

import {
	getAppSettings,
	subscribeAppSettingsChanged,
	updateAppSettings,
} from '@/renderer/api/ensemble';
import {
	type AppSettings,
	type AppSettingsPatch,
	DEFAULT_APP_SETTINGS,
} from '@/shared/config/app-settings';

/**
 * Renderer mirror of the App settings persisted in `config.json` (the source of
 * truth in the main process). Hydrated once at app start and kept in sync with
 * external edits by {@link useAppSettingsSync}. Writes go through IPC; the local
 * copy updates optimistically so the UI stays instant.
 */
export const appSettingsAtom = atom<AppSettings>(DEFAULT_APP_SETTINGS);

/**
 * Builds a writable atom over one `config.json` setting. Reads project the
 * mirror; writes optimistically update the mirror and persist the patch via IPC,
 * re-syncing from disk if the write fails.
 */
function settingAtom<
	Section extends keyof AppSettings,
	Key extends keyof AppSettings[Section],
>(section: Section, key: Key) {
	type Value = AppSettings[Section][Key];
	// Accept a direct value or an updater fn, matching the `atomWithStorage`
	// setter API these atoms replaced so existing call sites keep working.
	type Update = Value | ((prev: Value) => Value);
	return atom(
		(get) => get(appSettingsAtom)[section][key],
		(get, set, update: Update) => {
			const current = get(appSettingsAtom);
			const value =
				typeof update === 'function'
					? (update as (prev: Value) => Value)(current[section][key])
					: update;
			set(appSettingsAtom, {
				...current,
				[section]: { ...current[section], [key]: value },
			});
			const patch = { [section]: { [key]: value } } as AppSettingsPatch;
			void updateAppSettings(patch).catch(() => {
				void getAppSettings()
					.then((settings) => set(appSettingsAtom, settings))
					.catch(() => undefined);
			});
		},
	);
}

// ─── General ──────────────────────────────────────────────────────────────────
export const sendShortcutAtom = settingAtom('general', 'sendShortcut');
export const followUpBehaviorAtom = settingAtom('general', 'followUpBehavior');
export const desktopNotificationsAtom = settingAtom(
	'general',
	'desktopNotifications',
);
export const autoConvertLongTextAtom = settingAtom(
	'general',
	'autoConvertLongText',
);
export const alwaysShowContextUsageAtom = settingAtom(
	'general',
	'alwaysShowContextUsage',
);
export const caffeinateWhileRunningAtom = settingAtom(
	'general',
	'caffeinateWhileRunning',
);
export const toolCallCollapseAtom = settingAtom('general', 'toolCallCollapse');

// ─── Models ───────────────────────────────────────────────────────────────────
export const defaultChatModelAtom = settingAtom('models', 'defaultModel');
export const defaultChatThinkingLevelAtom = settingAtom(
	'models',
	'defaultThinkingLevel',
);
export const reviewModelAtom = settingAtom('models', 'reviewModel');
export const reviewThinkingLevelAtom = settingAtom(
	'models',
	'reviewThinkingLevel',
);
export const hiddenModelsAtom = settingAtom('models', 'hiddenModels');

/**
 * Hydrates {@link appSettingsAtom} from `config.json` on mount and live-reloads
 * it when the file is edited outside the app. Mount once at the app root.
 */
export function useAppSettingsSync(): void {
	const setSettings = useSetAtom(appSettingsAtom);
	useEffect(() => {
		let active = true;
		void getAppSettings()
			.then((settings) => {
				if (active) {
					setSettings(settings);
				}
			})
			.catch(() => undefined);
		const unsubscribe = subscribeAppSettingsChanged((event) => {
			setSettings(event.settings);
		});
		return () => {
			active = false;
			unsubscribe();
		};
	}, [setSettings]);
}
