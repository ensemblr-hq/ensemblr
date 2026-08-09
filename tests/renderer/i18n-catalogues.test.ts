import { describe, expect, test } from 'vitest';

import { I18N_NAMESPACES, resources } from '@/renderer/lib/i18n';
import { APP_LANGUAGES, FALLBACK_LANGUAGE } from '@/shared/i18n';

const PLURAL_SUFFIXES = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

/**
 * Flattens a nested catalogue into dot-joined leaf keys, matching the
 * `keySeparator: '.'` the runtime resolves with.
 * @param value - A catalogue object or leaf string
 * @param prefix - Accumulated key path
 * @returns Every leaf keyed by its full dotted path
 */
function flatten(value: unknown, prefix = ''): Record<string, string> {
	if (typeof value === 'string') {
		return { [prefix]: value };
	}
	if (!value || typeof value !== 'object') {
		return {};
	}
	const flattened: Record<string, string> = {};
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		Object.assign(flattened, flatten(child, prefix ? `${prefix}.${key}` : key));
	}
	return flattened;
}

/**
 * Splits a flattened key into its base and its CLDR plural suffix, if any.
 * @param key - A flattened catalogue key
 * @returns The base key and the plural category, or null when not a plural
 */
function splitPlural(key: string): { base: string; category: string } | null {
	const separator = key.lastIndexOf('_');
	if (separator < 0) {
		return null;
	}
	const category = key.slice(separator + 1);
	return PLURAL_SUFFIXES.has(category)
		? { base: key.slice(0, separator), category }
		: null;
}

/**
 * Collects the `{{…}}` interpolation names used in a message.
 * @param value - A catalogue message
 * @returns The placeholder names, sorted
 */
function placeholders(value: string): string[] {
	return [...value.matchAll(/\{\{\s*([\w.-]+)/g)]
		.map((match) => match[1] ?? '')
		.sort();
}

/**
 * Reads one flattened namespace out of the bundled resources.
 * @param language - The locale to read
 * @param namespace - The namespace to read
 * @returns Flattened key/value pairs
 */
function catalogue(
	language: string,
	namespace: string,
): Record<string, string> {
	const byNamespace = resources[language as keyof typeof resources] as Record<
		string,
		unknown
	>;
	return flatten(byNamespace[namespace]);
}

describe('catalogue structure', () => {
	test('every language ships every namespace', () => {
		for (const language of APP_LANGUAGES) {
			const byNamespace = resources[language];
			for (const namespace of I18N_NAMESPACES) {
				expect(byNamespace).toHaveProperty(namespace);
			}
		}
	});

	test('no English message is empty', () => {
		for (const namespace of I18N_NAMESPACES) {
			for (const [key, value] of Object.entries(
				catalogue(FALLBACK_LANGUAGE, namespace),
			)) {
				expect(value, `${namespace}:${key}`).not.toBe('');
			}
		}
	});

	// A value equal to its own key is what a failed extraction leaves behind, and
	// i18next renders it verbatim: the key resolves, so the `t()` default never
	// applies and the raw key ships as UI copy.
	test('no English message is its own key', () => {
		for (const namespace of I18N_NAMESPACES) {
			for (const [key, value] of Object.entries(
				catalogue(FALLBACK_LANGUAGE, namespace),
			)) {
				expect(value, `${namespace}:${key}`).not.toBe(key);
				expect(value, `${namespace}:${key}`).not.toBe(`${namespace}:${key}`);
			}
		}
	});
});

describe('translated catalogues', () => {
	const translated = APP_LANGUAGES.filter(
		(language) => language !== FALLBACK_LANGUAGE,
	);

	// The forward direction of the subset check below. Without it a whole key or
	// plural family can be deleted from `ru`/`el` and every other test still
	// passes, because they all iterate the translated locale's own keys —
	// `fallbackLng` then quietly serves English in its place.
	test('every English key is translated in every language', () => {
		for (const language of translated) {
			for (const namespace of I18N_NAMESPACES) {
				const bases = new Set(
					Object.keys(catalogue(language, namespace)).map(
						(key) => splitPlural(key)?.base ?? key,
					),
				);
				for (const key of Object.keys(
					catalogue(FALLBACK_LANGUAGE, namespace),
				)) {
					const base = splitPlural(key)?.base ?? key;
					expect(bases.has(base), `${language} ${namespace}:${key}`).toBe(true);
				}
			}
		}
	});

	// A key present in `ru` but not `en` is a typo that `fallbackLng` silently
	// hides: nothing ever asks for it, so it renders nowhere and never fails.
	test('keys are a subset of English', () => {
		for (const language of translated) {
			for (const namespace of I18N_NAMESPACES) {
				const english = catalogue(FALLBACK_LANGUAGE, namespace);
				for (const key of Object.keys(catalogue(language, namespace))) {
					const plural = splitPlural(key);
					const exists =
						key in english ||
						(plural !== null &&
							Object.keys(english).some(
								(candidate) => splitPlural(candidate)?.base === plural.base,
							));
					expect(exists, `${language} ${namespace}:${key}`).toBe(true);
				}
			}
		}
	});

	// A translator writing `{{cout}}` renders a literal `{{cout}}` on screen and
	// nothing else in the pipeline catches it.
	test('interpolation placeholders match their English counterpart', () => {
		for (const language of translated) {
			for (const namespace of I18N_NAMESPACES) {
				const english = catalogue(FALLBACK_LANGUAGE, namespace);
				for (const [key, value] of Object.entries(
					catalogue(language, namespace),
				)) {
					const source =
						english[key] ?? english[`${splitPlural(key)?.base}_other`];
					// An empty value is an untranslated skeleton entry, which
					// `returnEmptyString: false` renders as its English fallback.
					if (source === undefined || value === '') {
						continue;
					}
					expect(
						placeholders(value),
						`${language} ${namespace}:${key}`,
					).toEqual(placeholders(source));
				}
			}
		}
	});

	// Asserted against ICU rather than a hand-written expectation, so it stays
	// correct when a locale is added. A dropped Russian `_many` would otherwise
	// be papered over with English mid-sentence by `fallbackLng`.
	test('plural entries cover exactly their locale CLDR categories', () => {
		for (const language of APP_LANGUAGES) {
			const expected = new Set(
				new Intl.PluralRules(language).resolvedOptions().pluralCategories,
			);
			for (const namespace of I18N_NAMESPACES) {
				const byBase = new Map<string, Set<string>>();
				for (const key of Object.keys(catalogue(language, namespace))) {
					const plural = splitPlural(key);
					if (!plural) {
						continue;
					}
					const categories = byBase.get(plural.base) ?? new Set<string>();
					categories.add(plural.category);
					byBase.set(plural.base, categories);
				}
				for (const [base, categories] of byBase) {
					expect(
						[...categories].sort(),
						`${language} ${namespace}:${base}`,
					).toEqual([...expected].sort());
				}
			}
		}
	});
});
