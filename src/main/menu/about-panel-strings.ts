/**
 * Localized headings for the credits the native About panel shows.
 *
 * A const table rather than an i18next catalogue, for the same reason
 * `src/main/menu/menu-strings.ts` is one: the panel is drawn by the OS on the
 * main process's behalf, which cannot reach the renderer's i18n instance, and
 * three headings do not justify booting i18next into the main bundle. The
 * renderer's i18n linters scan `src/renderer/**` only, so nothing here is
 * extracted or checked by them — `tests/main/about-panel-strings.test.ts`
 * enforces key parity instead.
 *
 * A new key must be filled in all three languages in the same change.
 *
 * `coreProjects` heads the 49 direct runtime dependencies, not the ~537
 * packages the production tree resolves to — the transitive remainder ships
 * too. Hence "core" rather than "bundled" in all three languages: the shorter
 * word would be the one false claim on the surface.
 */

import { type AppLanguage, FALLBACK_LANGUAGE } from '../../shared/i18n.ts';

const ABOUT_PANEL_LABELS = {
	en: {
		coreProjects: 'Core open-source projects',
		developmentTools: 'Development tools',
		inspiredBy: 'Inspired by {{name}}',
	},
	ru: {
		coreProjects: 'Основные проекты с открытым исходным кодом',
		developmentTools: 'Инструменты разработки',
		inspiredBy: 'Вдохновлено проектом {{name}}',
	},
	el: {
		coreProjects: 'Βασικά έργα ανοιχτού κώδικα',
		developmentTools: 'Εργαλεία ανάπτυξης',
		inspiredBy: 'Με έμπνευση από το {{name}}',
	},
} as const satisfies Record<AppLanguage, Record<string, string>>;

/** The headings the About panel's credits need, in one language. English is canonical. */
export type AboutPanelStrings = Record<
	keyof (typeof ABOUT_PANEL_LABELS)['en'],
	string
>;

/**
 * Reads the About-panel credit headings for a language, falling back to English
 * for anything unrecognised so a bad settings value can never blank the panel.
 * @param language - The app's resolved UI language.
 * @returns The headings for that language.
 */
export function aboutPanelStrings(language: AppLanguage): AboutPanelStrings {
	return ABOUT_PANEL_LABELS[language] ?? ABOUT_PANEL_LABELS[FALLBACK_LANGUAGE];
}
