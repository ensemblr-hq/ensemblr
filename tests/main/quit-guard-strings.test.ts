import { describe, expect, test } from 'vitest';
import { quitGuardStrings } from '../../src/main/app/quit-guard-strings';
import { APP_LANGUAGES } from '../../src/shared/i18n';

describe('quitGuardStrings', () => {
	test('every language defines the same key set, none empty', () => {
		const english = Object.keys(quitGuardStrings('en')).sort();
		for (const language of APP_LANGUAGES) {
			const strings = quitGuardStrings(language);
			expect(Object.keys(strings).sort()).toEqual(english);
			for (const value of Object.values(strings)) {
				expect(value.length).toBeGreaterThan(0);
			}
		}
	});

	test('leaves no unsubstituted placeholder outside the overflow count', () => {
		for (const language of APP_LANGUAGES) {
			const { more, ...rest } = quitGuardStrings(language);
			expect(more).toContain('{{count}}');
			for (const value of Object.values(rest)) {
				expect(value).not.toContain('{{');
			}
		}
	});

	test('translates the buttons', () => {
		expect(quitGuardStrings('ru').cancel).toBe('Отмена');
		expect(quitGuardStrings('el').cancel).toBe('Άκυρο');
		expect(quitGuardStrings('en').quitAnyway).toBe('Quit Anyway');
	});

	test('falls back to English for an unrecognised language', () => {
		// A settings value outside the union can only arrive from a hand-edited
		// config; the cast reproduces that without weakening the public type.
		const strings = quitGuardStrings('kl' as never);
		expect(strings).toEqual(quitGuardStrings('en'));
	});
});
