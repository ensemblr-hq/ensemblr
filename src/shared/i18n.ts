/**
 * Language identity shared by every process: which languages ship message
 * catalogues, what the `general.language` setting may hold, and how an ordered
 * OS preference list resolves to one of them. Plain data plus one pure function
 * — no Electron, React, or fs — so the main process, preload, the renderer, and
 * node tests can all import it.
 */

/** Languages the app ships message catalogues for. */
export const APP_LANGUAGES = ['en', 'ru', 'el'] as const;

/** A language the app can render in. */
export type AppLanguage = (typeof APP_LANGUAGES)[number];

/** Accepted values of the `general.language` setting; `system` defers to the OS. */
export const LANGUAGE_PREFERENCES = ['system', ...APP_LANGUAGES] as const;

/** Stored value of the `general.language` setting. */
export type LanguagePreference = (typeof LANGUAGE_PREFERENCES)[number];

/** Language used when nothing else resolves; also every catalogue's `fallbackLng`. */
export const FALLBACK_LANGUAGE: AppLanguage = 'en';

/**
 * Native names of each supported language. Shown untranslated in the picker so a
 * user who has landed in a language they cannot read can still find their own.
 */
export const LANGUAGE_ENDONYMS: Record<AppLanguage, string> = {
	en: 'English',
	ru: 'Русский',
	el: 'Ελληνικά',
};

/**
 * Narrows an arbitrary value to a language the app ships a catalogue for.
 * @param value - Candidate language tag or setting value
 * @returns True when the value is one of {@link APP_LANGUAGES}
 */
export function isAppLanguage(value: unknown): value is AppLanguage {
	return (APP_LANGUAGES as readonly unknown[]).includes(value);
}

/**
 * Reduces a BCP-47 tag to its primary subtag so `ru-RU`, `el-CY`, and `en-GB`
 * each match the catalogue they belong to.
 * @param tag - A language tag such as `pt-BR`
 * @returns The lowercased primary subtag, or an empty string for a malformed tag
 */
function toPrimarySubtag(tag: string): string {
	return tag.split('-')[0]?.toLowerCase() ?? '';
}

/**
 * Resolves the language the app should render in: an explicit setting wins,
 * otherwise the OS preference order decides, falling back to English. Walking
 * the whole ordered list is what lets `['de-DE', 'ru-RU']` fall through an
 * unsupported German to Russian.
 * @param preference - The stored `general.language` setting
 * @param systemLanguages - OS language tags, most-preferred first
 * @returns The concrete language to render in
 */
export function resolveLanguage(
	preference: LanguagePreference,
	systemLanguages: readonly string[],
): AppLanguage {
	if (isAppLanguage(preference)) {
		return preference;
	}

	for (const tag of systemLanguages) {
		const primary = toPrimarySubtag(tag);
		if (isAppLanguage(primary)) {
			return primary;
		}
	}

	return FALLBACK_LANGUAGE;
}
