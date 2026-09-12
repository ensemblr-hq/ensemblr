import i18next, { type i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import {
	APP_LANGUAGES,
	type AppLanguage,
	FALLBACK_LANGUAGE,
	isAppLanguage,
} from '@/shared/i18n';

import {
	DEFAULT_NAMESPACE,
	I18N_NAMESPACES,
	type LanguageCatalogue,
	loadCatalogue,
} from './resources';

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
 */
export const i18n: I18nInstance = i18next.createInstance();

const loadedCatalogues = new Map<AppLanguage, Promise<LanguageCatalogue>>();

/**
 * Fetches a language's catalogue once and registers every namespace on the
 * singleton, so a second call for the same language is free.
 * @param language - The language to make resolvable
 * @returns The registered catalogue
 */
export function ensureLanguageCatalogue(
	language: AppLanguage,
): Promise<LanguageCatalogue> {
	const pending =
		loadedCatalogues.get(language) ??
		loadCatalogue(language).then((catalogue) => {
			for (const namespace of I18N_NAMESPACES) {
				i18n.addResourceBundle(language, namespace, catalogue[namespace]);
			}
			return catalogue;
		});

	loadedCatalogues.set(language, pending);
	return pending;
}

const initialCatalogue = await loadCatalogue(INITIAL_LANGUAGE);

/**
 * Only the resolved language is seeded. This module carries a top-level await,
 * so ESM holds every importer's evaluation until `init` has resolved — which is
 * what lets the `lib/` modules that call `t()` at module scope keep doing so,
 * and what removes the flash of English a post-mount `changeLanguage` would
 * cause. The other two languages arrive through
 * {@link ensureLanguageCatalogue} when the user switches.
 */
await i18n.use(initReactI18next).init({
	resources: { [INITIAL_LANGUAGE]: initialCatalogue },
	lng: INITIAL_LANGUAGE,
	fallbackLng: FALLBACK_LANGUAGE,
	supportedLngs: APP_LANGUAGES,
	ns: I18N_NAMESPACES,
	defaultNS: DEFAULT_NAMESPACE,
	// A locale that has not caught up renders its English fallback rather than an
	// empty string, which is what keeps every slice shippable mid-migration.
	returnEmptyString: false,
	returnNull: false,
	// React escapes interpolated values already; escaping again double-encodes.
	interpolation: { escapeValue: false },
	react: {
		// `<Trans>` parses the *interpolated* string as markup and re-materialises
		// any tag in this list, so a branch named `<strong>Verified</strong>` puts
		// copy the app never wrote into a confirmation dialog. The catalogues use
		// named `components` keys, never bare tags, so emptying it costs nothing.
		// It does not cover a value naming a `components` key — a call site with an
		// untrusted value renders it as a child instead.
		transKeepBasicHtmlNodesFor: [],
	},
});

loadedCatalogues.set(INITIAL_LANGUAGE, Promise.resolve(initialCatalogue));

/**
 * Switches the singleton to a language, fetching its catalogue chunk first.
 *
 * The one way to change language. Only the launch language is bundled eagerly,
 * so calling `i18n.changeLanguage` directly renders raw keys until the chunk
 * happens to land — which is a race, not a delay, because nothing re-renders
 * when it does.
 * @param language - The language the app should render in
 * @returns Resolves once the catalogue is registered and the switch has applied
 */
export async function changeAppLanguage(language: AppLanguage): Promise<void> {
	await ensureLanguageCatalogue(language);
	await i18n.changeLanguage(language);
}

if (INITIAL_LANGUAGE !== FALLBACK_LANGUAGE) {
	void ensureLanguageCatalogue(FALLBACK_LANGUAGE);
}

// Node-environment tests import this module for its catalogues alone, where
// there is no document to tag.
globalThis.document?.documentElement.setAttribute('lang', INITIAL_LANGUAGE);
