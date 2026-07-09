import { useSetAtom } from 'jotai';
import { useEffect, useRef } from 'react';

import { getAppSettings, updateAppSettings } from '@/renderer/api/ensemble';
import {
	type AppearanceSettings,
	appearanceSettingsSchema,
	DEFAULT_APP_SETTINGS,
} from '@/shared/config/app-settings';
import { appSettingsAtom } from './app-settings';

/**
 * Legacy `atomWithStorage` keys the Appearance prefs used before they moved onto
 * `config.json`. Read once to seed the new store, then deleted.
 */
const LEGACY_KEYS: Record<keyof AppearanceSettings, string> = {
	theme: 'ensemble_pref_theme',
	coloredSidebarDiffs: 'ensemble_pref_colored_sidebar_diffs',
	accessibleColors: 'ensemble_pref_accessible_colors',
	codeTheme: 'ensemble_pref_code_theme',
	monoFont: 'ensemble_pref_mono_font',
	codeLigatures: 'ensemble_pref_code_ligatures',
	markdownStyle: 'ensemble_pref_markdown_style',
	terminalFont: 'ensemble_pref_terminal_font',
	terminalFontSize: 'ensemble_pref_terminal_font_size',
};

/**
 * Collects any legacy appearance values still in `localStorage`, JSON-decoding
 * each and dropping fields that fail validation.
 * @param storage - The window `localStorage` to read from.
 * @returns The validated partial patch plus every legacy key that was present
 *   (so callers can delete them even when their value was unusable).
 */
function readLegacyAppearance(storage: Storage): {
	patch: Partial<AppearanceSettings>;
	foundKeys: string[];
} {
	const raw: Record<string, unknown> = {};
	const foundKeys: string[] = [];
	for (const [field, key] of Object.entries(LEGACY_KEYS)) {
		const stored = storage.getItem(key);
		if (stored === null) {
			continue;
		}
		foundKeys.push(key);
		try {
			raw[field] = JSON.parse(stored);
		} catch {
			// Non-JSON legacy value: ignore it but still remove the stale key.
		}
	}
	// The code-theme enum renamed `one-dark` → `one-dark-pro`; carry the old
	// selection across instead of letting it fall back to the default.
	if (raw.codeTheme === 'one-dark') {
		raw.codeTheme = 'one-dark-pro';
	}
	const parsed = appearanceSettingsSchema.partial().safeParse(raw);
	return { patch: parsed.success ? parsed.data : {}, foundKeys };
}

/** True when every appearance field still holds its shipped default. */
function isDefaultAppearance(appearance: AppearanceSettings): boolean {
	const defaults = DEFAULT_APP_SETTINGS.appearance;
	return (Object.keys(defaults) as Array<keyof AppearanceSettings>).every(
		(key) => appearance[key] === defaults[key],
	);
}

/**
 * One-time migration of the Appearance prefs from their legacy `localStorage`
 * keys onto the `config.json` app-settings store. Runs once at app start: if the
 * config store is still at defaults, the saved values (theme especially) are
 * seeded so they survive the move instead of silently resetting. The legacy keys
 * are removed only after a successful write, so a failed write is retried next
 * launch. Mount once at the app root, beside {@link useAppSettingsSync}.
 */
export function useAppearanceLegacyMigration(): void {
	const setSettings = useSetAtom(appSettingsAtom);
	const ranRef = useRef(false);
	useEffect(() => {
		if (ranRef.current) {
			return;
		}
		ranRef.current = true;
		const storage =
			typeof globalThis.localStorage === 'undefined'
				? null
				: globalThis.localStorage;
		if (!storage) {
			return;
		}
		const { patch, foundKeys } = readLegacyAppearance(storage);
		if (foundKeys.length === 0) {
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				if (Object.keys(patch).length > 0) {
					const current = await getAppSettings();
					if (isDefaultAppearance(current.appearance)) {
						const next = await updateAppSettings({ appearance: patch });
						if (!cancelled) {
							setSettings(next);
						}
					}
				}
			} catch {
				// Persistence failed — keep the legacy keys so a later run retries.
				return;
			}
			for (const key of foundKeys) {
				storage.removeItem(key);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [setSettings]);
}
