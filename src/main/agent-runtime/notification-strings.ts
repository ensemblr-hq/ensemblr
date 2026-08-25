import type { AppLanguage } from '../../shared/i18n.ts';

/**
 * Desktop-notification copy in every shipped language.
 *
 * The main process gets a const table rather than an i18next instance, for the
 * same reason `src/main/menu/menu-strings.ts` does: booting the library here
 * would pull it into the main bundle and keep a second copy of the catalogues,
 * for a handful of strings. `{{workspace}}` is substituted by {@link notificationText}.
 *
 * The notification *title* is the chat tab's own name, which the renderer and
 * the naming pipeline already produce localized — only the body and the
 * fallback for an unnamed tab live here.
 *
 * The Concierge belongs to no workspace and holds no chat tab, so its two lines
 * substitute nothing and its title is the feature's own name.
 */
const NOTIFICATION_STRINGS = {
	en: {
		conciergeFinished: 'Finished',
		conciergeQuestion: 'Waiting for your answer',
		conciergeTitle: 'Concierge',
		finished: 'Finished in {{workspace}}',
		question: 'Waiting for your answer in {{workspace}}',
		untitledChat: 'Untitled chat',
	},
	ru: {
		conciergeFinished: 'Завершено',
		conciergeQuestion: 'Ожидает вашего ответа',
		conciergeTitle: 'Консьерж',
		finished: 'Завершено в {{workspace}}',
		question: 'Ожидает вашего ответа в {{workspace}}',
		untitledChat: 'Чат без названия',
	},
	el: {
		conciergeFinished: 'Ολοκληρώθηκε',
		conciergeQuestion: 'Περιμένει την απάντησή σας',
		conciergeTitle: 'Concierge',
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

/**
 * Renders the Concierge's own notification, which names no workspace and no tab.
 *
 * Split from {@link notificationText} rather than folded into it as two nullable
 * parameters: the Concierge has neither of the two facts that function is built
 * around, and a caller passing `null` twice would be describing the absence of a
 * chat rather than the presence of a Concierge.
 * @param kind - Whether the Concierge finished a turn or is blocked on a question.
 * @param language - The language notification copy is rendered in.
 * @returns The Concierge's name as the title and the matching one-line body.
 */
export function conciergeNotificationText({
	kind,
	language,
}: {
	kind: NotificationKind;
	language: AppLanguage;
}): NotificationText {
	const strings = NOTIFICATION_STRINGS[language];
	return {
		body:
			kind === 'question'
				? strings.conciergeQuestion
				: strings.conciergeFinished,
		title: strings.conciergeTitle,
	};
}
