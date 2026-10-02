import { describe, expect, test } from 'vitest';
import { confirmDialogStrings } from '../../src/main/agent-control/confirm-dialog-strings';
import { APP_LANGUAGES } from '../../src/shared/i18n';

describe('confirmDialogStrings', () => {
	test('every language defines the same key set, none empty', () => {
		const english = Object.keys(confirmDialogStrings('en')).sort();
		for (const language of APP_LANGUAGES) {
			const strings = confirmDialogStrings(language);
			expect(Object.keys(strings).sort()).toEqual(english);
			for (const value of Object.values(strings)) {
				expect(value.length).toBeGreaterThan(0);
			}
		}
	});

	test('translates the buttons', () => {
		expect(confirmDialogStrings('ru').allow).toBe('Разрешить');
		expect(confirmDialogStrings('el').deny).toBe('Απόρριψη');
		expect(confirmDialogStrings('en').allow).toBe('Allow');
	});

	test('falls back to English for an unrecognised language', () => {
		// A settings value outside the union can only arrive from a hand-edited
		// config; the cast reproduces that without weakening the public type.
		const strings = confirmDialogStrings('kl' as never);
		expect(strings).toEqual(confirmDialogStrings('en'));
	});
});
