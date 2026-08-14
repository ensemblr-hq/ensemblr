import { describe, expect, test } from 'vitest';
import {
	type NotificationKind,
	notificationText,
} from '../../src/main/agent-runtime/notification-strings';
import { APP_LANGUAGES } from '../../src/shared/i18n';

const KINDS: readonly NotificationKind[] = ['finished', 'question'];

describe('notificationText', () => {
	test('every language renders every kind, none empty', () => {
		for (const language of APP_LANGUAGES) {
			for (const kind of KINDS) {
				const { body, title } = notificationText({
					kind,
					language,
					tabTitle: 'Fix the notifier',
					workspaceName: 'vangelis',
				});
				expect(body.length).toBeGreaterThan(0);
				expect(title).toBe('Fix the notifier');
			}
		}
	});

	test('substitutes the workspace, leaving no placeholder behind', () => {
		for (const language of APP_LANGUAGES) {
			for (const kind of KINDS) {
				const { body } = notificationText({
					kind,
					language,
					tabTitle: null,
					workspaceName: 'vangelis',
				});
				expect(body).toContain('vangelis');
				expect(body).not.toContain('{{');
			}
		}
	});

	test('falls back to a localized title for an unnamed tab', () => {
		const titles = APP_LANGUAGES.map(
			(language) =>
				notificationText({
					kind: 'finished',
					language,
					tabTitle: null,
					workspaceName: 'vangelis',
				}).title,
		);
		for (const title of titles) {
			expect(title.length).toBeGreaterThan(0);
		}
		expect(new Set(titles).size).toBe(APP_LANGUAGES.length);
	});

	test('treats a whitespace-only tab name as unnamed', () => {
		const blank = notificationText({
			kind: 'finished',
			language: 'en',
			tabTitle: '   ',
			workspaceName: 'vangelis',
		});
		expect(blank.title).toBe('Untitled chat');
	});
});
