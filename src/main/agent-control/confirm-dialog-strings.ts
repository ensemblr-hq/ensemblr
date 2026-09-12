/**
 * Localized copy for the native "an agent wants to do X" confirmation dialog.
 *
 * A const table rather than an i18next catalogue, for the same reason
 * `src/main/menu/menu-strings.ts` and `src/main/app/quit-guard-strings.ts` are
 * one: the dialog is drawn by the main process, which cannot reach the
 * renderer's i18n instance. The renderer's i18n linters scan `src/renderer/**`
 * only, so nothing here is extracted or checked by them —
 * `tests/main/confirm-dialog-strings.test.ts` enforces key parity instead.
 *
 * A new key must be filled in all three languages in the same change.
 */

import { type AppLanguage, FALLBACK_LANGUAGE } from '../../shared/i18n.ts';

const CONFIRM_DIALOG_LABELS = {
	en: {
		allow: 'Allow',
		deny: 'Deny',
		message: 'An agent requested to control Ensemblr.',
		title: 'Agent control request',
	},
	ru: {
		allow: 'Разрешить',
		deny: 'Отклонить',
		message: 'Агент запросил управление Ensemblr.',
		title: 'Запрос управления агентом',
	},
	el: {
		allow: 'Αποδοχή',
		deny: 'Απόρριψη',
		message: 'Ένας πράκτορας ζήτησε να ελέγξει το Ensemblr.',
		title: 'Αίτημα ελέγχου από πράκτορα',
	},
} as const satisfies Record<AppLanguage, Record<string, string>>;

/** The copy the agent-control confirmation dialog needs, in one language. English is canonical. */
export type ConfirmDialogStrings = Record<
	keyof (typeof CONFIRM_DIALOG_LABELS)['en'],
	string
>;

/**
 * Reads the agent-control confirmation copy for a language, falling back to
 * English for anything unrecognised so a bad settings value can never blank
 * the dialog.
 * @param language - The app's resolved UI language.
 * @returns The copy for that language.
 */
export function confirmDialogStrings(
	language: AppLanguage,
): ConfirmDialogStrings {
	return (
		CONFIRM_DIALOG_LABELS[language] ?? CONFIRM_DIALOG_LABELS[FALLBACK_LANGUAGE]
	);
}
