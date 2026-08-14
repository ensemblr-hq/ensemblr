import type { AppLanguage } from '../../shared/i18n.ts';

/**
 * Desktop-notification copy in every shipped language.
 *
 * The main process gets a const table rather than an i18next instance, for the
 * same reason `src/main/menu/menu-strings.ts` does: booting the library here
 * would pull it into the main bundle and keep a second copy of the catalogues,
 * for three strings. `{{workspace}}` is substituted by {@link notificationText}.
 *
 * The notification *title* is the chat tab's own name, which the renderer and
 * the naming pipeline already produce localized — only the body and the
 * fallback for an unnamed tab live here.
 */
const NOTIFICATION_STRINGS = {
	en: {
		finished: 'Finished in {{workspace}}',
		question: 'Waiting for your answer in {{workspace}}',
		untitledChat: 'Untitled chat',
	},
	ru: {
		finished: 'Завершено в {{workspace}}',
		question: 'Ожидает вашего ответа в {{workspace}}',
		untitledChat: 'Чат без названия',
	},
	el: {
		finished: 'Ολοκληρώθηκε στο {{workspace}}',
		question: 'Περιμένει την απάντησή σας στο {{workspace}}',
		untitledChat: 'Συνομιλία χωρίς τίτλο',
	},
} as const satisfies Record<AppLanguage, Record<string, string>>;

/** Which notification a finished-or-blocked chat produces. */
export type NotificationKind = 'finished' | 'question';

/** One notification's rendered title and body. */
export interface NotificationText {
	body: string;
	title: string;
}

/**
 * Renders a notification's title and body in the app's language.
 * @param input - The language, the notification kind, and the chat it describes.
 * @returns The tab name as the title and the workspace-naming line as the body.
 */
export function notificationText({
	kind,
	language,
	tabTitle,
	workspaceName,
}: {
	kind: NotificationKind;
	language: AppLanguage;
	tabTitle: string | null;
	workspaceName: string;
}): NotificationText {
	const strings = NOTIFICATION_STRINGS[language];
	return {
		body: strings[kind].replace('{{workspace}}', workspaceName),
		title: tabTitle?.trim() || strings.untitledChat,
	};
}
