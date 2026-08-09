import i18next from 'i18next';
import { beforeAll, describe, expect, test } from 'vitest';

import { FALLBACK_LANGUAGE } from '@/shared/i18n';

// i18next 26 resolves CLDR categories through the native `Intl.PluralRules`, so
// no ICU plugin is installed. These fixtures exercise that wiring against the
// same init options `src/renderer/lib/i18n/instance.ts` uses; the real
// catalogues are checked for category completeness in i18n-catalogues.test.ts.
const RESOURCES = {
	el: {
		common: {
			'file-count_one': '{{count}} αρχείο',
			'file-count_other': '{{count}} αρχεία',
		},
	},
	en: {
		common: {
			'file-count_one': '{{count}} file',
			'file-count_other': '{{count}} files',
		},
	},
	ru: {
		common: {
			'file-count_few': '{{count}} файла',
			'file-count_many': '{{count}} файлов',
			'file-count_one': '{{count}} файл',
			'file-count_other': '{{count}} файла',
		},
	},
};

const instance = i18next.createInstance();

beforeAll(async () => {
	await instance.init({
		resources: RESOURCES,
		lng: FALLBACK_LANGUAGE,
		fallbackLng: FALLBACK_LANGUAGE,
		ns: ['common'],
		defaultNS: 'common',
		returnEmptyString: false,
		returnNull: false,
		interpolation: { escapeValue: false },
	});
});

/**
 * Fixed translator for one locale, typed loosely on purpose: these fixture keys
 * live outside the generated key union so the plural wiring can be exercised
 * without depending on a real catalogue key that a later slice might rename.
 * @param language - Locale to bind the translator to
 * @returns A translator taking a fixture key and a count
 */
function translator(
	language: string,
): (key: string, options: { count: number }) => string {
	return instance.getFixedT(language) as unknown as (
		key: string,
		options: { count: number },
	) => string;
}

describe('plural selection', () => {
	// 11 and 21 are where a naive `n % 10` implementation breaks: 21 takes the
	// singular form and 11 does not.
	test('Russian picks one/few/many across the awkward counts', () => {
		const t = translator('ru');
		expect(t('file-count', { count: 1 })).toBe('1 файл');
		expect(t('file-count', { count: 2 })).toBe('2 файла');
		expect(t('file-count', { count: 5 })).toBe('5 файлов');
		expect(t('file-count', { count: 11 })).toBe('11 файлов');
		expect(t('file-count', { count: 21 })).toBe('21 файл');
		expect(t('file-count', { count: 0 })).toBe('0 файлов');
	});

	test('English and Greek use their two categories', () => {
		const en = translator('en');
		expect(en('file-count', { count: 1 })).toBe('1 file');
		expect(en('file-count', { count: 5 })).toBe('5 files');

		const el = translator('el');
		expect(el('file-count', { count: 1 })).toBe('1 αρχείο');
		expect(el('file-count', { count: 5 })).toBe('5 αρχεία');
	});

	test('an untranslated language falls back to English rather than a raw key', () => {
		expect(translator('de')('file-count', { count: 3 })).toBe('3 files');
	});
});
