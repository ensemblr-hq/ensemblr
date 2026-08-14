/**
 * Localized copy for the native "agents are still running" quit confirmation.
 *
 * A const table rather than an i18next catalogue, for the same reason
 * `src/main/menu/menu-strings.ts` is one: the dialog is drawn by the main
 * process, which cannot reach the renderer's i18n instance, and six strings do
 * not justify booting i18next into the main bundle. The renderer's i18n linters
 * scan `src/renderer/**` only, so nothing here is extracted or checked by them —
 * `tests/main/quit-guard-strings.test.ts` enforces key parity instead.
 *
 * A new key must be filled in all three languages in the same change.
 */

import { type AppLanguage, FALLBACK_LANGUAGE } from '../../shared/i18n.ts';

const QUIT_GUARD_LABELS = {
	en: {
		cancel: 'Cancel',
		chat: 'Chat',
		detailIntro: 'Quitting now stops them mid-turn.',
		message: 'Agents are still running',
		more: '+{{count}} more',
		quitAnyway: 'Quit Anyway',
	},
	ru: {
		cancel: 'Отмена',
		chat: 'Чат',
		detailIntro: 'Выход сейчас прервёт их работу.',
		message: 'Агенты ещё работают',
		more: '+ ещё {{count}}',
		quitAnyway: 'Всё равно завершить',
	},
	el: {
		cancel: 'Άκυρο',
		chat: 'Συνομιλία',
		detailIntro: 'Η έξοδος τώρα θα τους διακόψει.',
		message: 'Πράκτορες εκτελούνται ακόμη',
		more: '+ {{count}} ακόμη',
		quitAnyway: 'Τερματισμός ούτως ή άλλως',
	},
} as const satisfies Record<AppLanguage, Record<string, string>>;

/** The copy the quit confirmation needs, in one language. English is canonical. */
export type QuitGuardStrings = Record<
	keyof (typeof QUIT_GUARD_LABELS)['en'],
	string
>;

/**
 * Reads the quit-confirmation copy for a language, falling back to English for
 * anything unrecognised so a bad settings value can never blank the dialog.
 * @param language - The app's resolved UI language.
 * @returns The copy for that language.
 */
export function quitGuardStrings(language: AppLanguage): QuitGuardStrings {
	return QUIT_GUARD_LABELS[language] ?? QUIT_GUARD_LABELS[FALLBACK_LANGUAGE];
}
