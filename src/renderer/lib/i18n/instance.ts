import i18next, { type i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import {
	type AppLanguage,
	FALLBACK_LANGUAGE,
	isAppLanguage,
} from '@/shared/i18n';

import { DEFAULT_NAMESPACE, I18N_NAMESPACES, resources } from './resources';

/**
 * Reads the language the main process already resolved from the stored setting
 * and the OS preference order, seeded into the preload snapshot before the
 * renderer loads. Starting here rather than at English and correcting in a
 * React effect is what removes the flash of English on every launch.
 *
 * Read off `globalThis` rather than `window` so the module still type-checks in
 * the `scripts` project, whose file set excludes the renderer's DOM globals.
 * @returns The language to render the first paint in
 */
function initialLanguage(): AppLanguage {
	const seeded = (
		globalThis as {
			ensemblrInitialShellSnapshot?: { language?: unknown };
		}
	).ensemblrInitialShellSnapshot?.language;
	return isAppLanguage(seeded) ? seeded : FALLBACK_LANGUAGE;
}

/** Language the first paint renders in, before {@link useLanguageEffect} runs. */
export const INITIAL_LANGUAGE = initialLanguage();

/**
 * The app-wide i18next singleton. `initReactI18next` registers it as the
 * instance `useTranslation` and `<Trans>` resolve to, so no provider is needed.
 * Because `resources` are bundled, `init` completes synchronously during module
 * evaluation and `t()` is callable from module scope immediately after import.
 */
export const i18n: I18nInstance = i18next.createInstance();

void i18n.use(initReactI18next).init({
	resources,
	lng: INITIAL_LANGUAGE,
	fallbackLng: FALLBACK_LANGUAGE,
	supportedLngs: Object.keys(resources),
	ns: I18N_NAMESPACES,
	defaultNS: DEFAULT_NAMESPACE,
	// A locale that has not caught up renders its English fallback rather than an
	// empty string, which is what keeps every slice shippable mid-migration.
	returnEmptyString: false,
	returnNull: false,
	// React escapes interpolated values already; escaping again double-encodes.
	interpolation: { escapeValue: false },
});

// Node-environment tests import this module for its catalogues alone, where
// there is no document to tag.
globalThis.document?.documentElement.setAttribute('lang', INITIAL_LANGUAGE);
