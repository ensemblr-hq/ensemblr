/**
 * Localized copy for the native confirmation the permission gate raises when a
 * repository runs in `approval-required` mode.
 *
 * A const table rather than an i18next catalogue, for the same reason
 * `src/main/app/quit-guard-strings.ts` is one: the dialog is drawn by the main
 * process, which cannot reach the renderer's i18n instance. The renderer's i18n
 * linters scan `src/renderer/**` only, so key parity is enforced by
 * `tests/main/permissions.test.ts` instead.
 *
 * A new key must be filled in all three languages in the same change. The
 * action kind is interpolated as its locale-neutral code, which stays English
 * in every language the same way `commit` and `branch` do.
 */

import { type AppLanguage, FALLBACK_LANGUAGE } from '../../shared/i18n.ts';

const PERMISSION_CONFIRM_LABELS = {
	en: {
		allow: 'Allow',
		deny: 'Deny',
		detail: 'Action: {{action}}',
		message: 'This repository asks for approval before each change.',
		title: 'Approval required',
	},
	ru: {
		allow: 'Разрешить',
		deny: 'Отклонить',
		detail: 'Действие: {{action}}',
		message: 'Этот репозиторий требует подтверждения каждого изменения.',
		title: 'Требуется подтверждение',
	},
	el: {
		allow: 'Να επιτραπεί',
		deny: 'Άρνηση',
		detail: 'Ενέργεια: {{action}}',
		message: 'Αυτό το αποθετήριο ζητά έγκριση πριν από κάθε αλλαγή.',
		title: 'Απαιτείται έγκριση',
	},
} as const satisfies Record<AppLanguage, Record<string, string>>;

/** The copy the permission confirmation needs, in one language. English is canonical. */
export type PermissionConfirmStrings = Record<
	keyof (typeof PERMISSION_CONFIRM_LABELS)['en'],
	string
>;

/**
 * Reads the permission-confirmation copy for a language, falling back to
 * English for anything unrecognised so a bad settings value cannot blank the
 * dialog.
 * @param language - The app's resolved UI language.
 * @returns The copy for that language.
 */
export function permissionConfirmStrings(
	language: AppLanguage,
): PermissionConfirmStrings {
	return (
		PERMISSION_CONFIRM_LABELS[language] ??
		PERMISSION_CONFIRM_LABELS[FALLBACK_LANGUAGE]
	);
}
