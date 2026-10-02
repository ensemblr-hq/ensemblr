import { describe, expect, test } from 'vitest';

import {
	APP_LANGUAGES,
	FALLBACK_LANGUAGE,
	isAppLanguage,
	LANGUAGE_ENDONYMS,
	LANGUAGE_PREFERENCES,
	resolveLanguage,
} from '../../src/shared/i18n';

describe('resolveLanguage', () => {
	test('an explicit preference beats the OS list', () => {
		expect(resolveLanguage('el', ['ru-RU', 'en-US'])).toBe('el');
		expect(resolveLanguage('en', ['ru-RU'])).toBe('en');
	});

	test('matches on the primary subtag so regional tags resolve', () => {
		expect(resolveLanguage('system', ['el-GR', 'en-US'])).toBe('el');
		expect(resolveLanguage('system', ['ru-RU'])).toBe('ru');
		expect(resolveLanguage('system', ['en-GB'])).toBe('en');
		expect(resolveLanguage('system', ['EL-CY'])).toBe('el');
	});

	// The one test protecting the `getPreferredSystemLanguages()` choice: an
	// ordered list is what lets an unsupported first language fall through.
	// `getLocale()` would collapse this to a single narrowed tag.
	test('walks the OS list in order, past unsupported languages', () => {
		expect(resolveLanguage('system', ['de-DE', 'ru-RU'])).toBe('ru');
		expect(resolveLanguage('system', ['fr-CA', 'zh-Hans-CN', 'el'])).toBe('el');
	});

	test('falls back to English for an empty or unsupported list', () => {
		expect(resolveLanguage('system', [])).toBe('en');
		expect(resolveLanguage('system', ['de-DE', 'fr-FR'])).toBe('en');
		expect(resolveLanguage('system', [''])).toBe('en');
	});
});

describe('language tables', () => {
	test('every shipped language has an endonym, and no extras exist', () => {
		expect(Object.keys(LANGUAGE_ENDONYMS).sort()).toEqual(
			[...APP_LANGUAGES].sort(),
		);
	});

	test('preferences are `system` plus every shipped language', () => {
		expect(LANGUAGE_PREFERENCES).toEqual(['system', ...APP_LANGUAGES]);
	});

	test('the fallback is a shipped language', () => {
		expect(isAppLanguage(FALLBACK_LANGUAGE)).toBe(true);
	});

	test('isAppLanguage rejects preferences and unknown tags', () => {
		expect(isAppLanguage('system')).toBe(false);
		expect(isAppLanguage('de')).toBe(false);
		expect(isAppLanguage(undefined)).toBe(false);
	});
});
