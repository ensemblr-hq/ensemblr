import { describe, expect, test } from 'vitest';
import { linearCallbackPageStrings } from '../../src/main/linear/linear-callback-page-strings';
import { APP_LANGUAGES } from '../../src/shared/i18n';

describe('linearCallbackPageStrings', () => {
	test('every language defines the same key set, none empty', () => {
		const english = Object.keys(linearCallbackPageStrings('en')).sort();
		for (const language of APP_LANGUAGES) {
			const strings = linearCallbackPageStrings(language);
			expect(Object.keys(strings).sort()).toEqual(english);
			for (const value of Object.values(strings)) {
				expect(value.length).toBeGreaterThan(0);
			}
		}
	});

	// The page is served the moment the redirect lands — before the exchange,
	// and whether or not Linear sent back a denial — so claiming the connection
	// succeeded is the one thing it must never do.
	test('claims nothing about the outcome in any language', () => {
		const outcomeClaims = [/connected/i, /подключ/i, /συνδέθηκ/i, /success/i];
		for (const language of APP_LANGUAGES) {
			const copy = Object.values(linearCallbackPageStrings(language)).join(' ');
			for (const claim of outcomeClaims) {
				expect(copy).not.toMatch(claim);
			}
		}
	});

	test('falls back to English for an unrecognised language', () => {
		// A settings value outside the union can only arrive from a hand-edited
		// config; the cast reproduces that without weakening the public type.
		expect(linearCallbackPageStrings('kl' as never)).toEqual(
			linearCallbackPageStrings('en'),
		);
	});
});
