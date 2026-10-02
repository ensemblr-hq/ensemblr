/**
 * Localized copy for the page the browser lands on after a Linear OAuth
 * redirect.
 *
 * A const table rather than an i18next catalogue, for the same reason
 * `src/main/app/quit-guard-strings.ts` is one: the page is served by the main
 * process — to a browser, not to the renderer — so there is no i18n instance to
 * reach and no code to hand back. The renderer's i18n linters scan
 * `src/renderer/**` only, so nothing here is extracted or checked by them;
 * `tests/main/linear-callback-page-strings.test.ts` enforces key parity instead.
 *
 * The copy claims nothing about the outcome. The page is served the moment the
 * redirect arrives — before the token exchange, whether or not Linear sent back
 * a denial, and whether or not the user already canceled in the app — so it can
 * only point at the surface that does know.
 *
 * A new key must be filled in all three languages in the same change.
 */

import { type AppLanguage, FALLBACK_LANGUAGE } from '../../shared/i18n.ts';

const CALLBACK_PAGE_LABELS = {
	en: {
		body: 'Ensemblr takes it from here — the app shows whether the sign-in went through.',
		heading: 'You can close this tab',
	},
	ru: {
		body: 'Дальше всё сделает Ensemblr — результат входа виден в приложении.',
		heading: 'Эту вкладку можно закрыть',
	},
	el: {
		body: 'Το Ensemblr συνεχίζει από εδώ — η εφαρμογή δείχνει αν η σύνδεση ολοκληρώθηκε.',
		heading: 'Μπορείτε να κλείσετε αυτήν την καρτέλα',
	},
} as const satisfies Record<AppLanguage, Record<string, string>>;

/** The copy the OAuth callback page needs, in one language. English is canonical. */
export type LinearCallbackPageStrings = Record<
	keyof (typeof CALLBACK_PAGE_LABELS)['en'],
	string
>;

/**
 * Reads the callback-page copy for a language, falling back to English for
 * anything unrecognised so a bad settings value can never blank the page.
 * @param language - The app's resolved UI language.
 * @returns The copy for that language.
 */
export function linearCallbackPageStrings(
	language: AppLanguage,
): LinearCallbackPageStrings {
	return (
		CALLBACK_PAGE_LABELS[language] ?? CALLBACK_PAGE_LABELS[FALLBACK_LANGUAGE]
	);
}
