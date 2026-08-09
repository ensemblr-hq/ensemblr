import { useAtomValue } from 'jotai';
import { useEffect } from 'react';

import { getSystemLanguages } from '@/renderer/api/ensemblr';
import { i18n } from '@/renderer/lib/i18n';
import { type AppLanguage, resolveLanguage } from '@/shared/i18n';

import { appSettingsAtom } from './app-settings';

let systemLanguages: Promise<readonly string[]> | null = null;

/**
 * Reads the OS language preference order once per session. macOS requires a
 * relaunch to change the list, so a successful read cannot go stale. A failed
 * read clears the cache instead of poisoning it, so one unavailable-bridge
 * moment does not pin the session to "no preference" for its whole lifetime.
 * @returns OS language tags, most-preferred first
 */
function loadSystemLanguages(): Promise<readonly string[]> {
	systemLanguages ??= getSystemLanguages().catch(() => {
		systemLanguages = null;
		return [];
	});
	return systemLanguages;
}

/**
 * Switches i18next and the `<html lang>` attribute to the given language.
 * @param language - The language the app should render in
 */
function applyLanguage(language: AppLanguage): void {
	if (i18n.language !== language) {
		void i18n.changeLanguage(language);
	}
	document.documentElement.lang = language;
}

/**
 * Applies the resolved UI language whenever the `general.language` setting
 * changes, combining it with the OS preference order. Mount once at the app
 * root beside {@link useThemeEffect}; `changeLanguage` re-renders every
 * `useTranslation` consumer, so a switch needs no restart.
 */
export function useLanguageEffect(): void {
	const preference = useAtomValue(appSettingsAtom).general.language;

	useEffect(() => {
		let active = true;
		void loadSystemLanguages().then((tags) => {
			if (active) {
				applyLanguage(resolveLanguage(preference, tags));
			}
		});
		return () => {
			active = false;
		};
	}, [preference]);
}
