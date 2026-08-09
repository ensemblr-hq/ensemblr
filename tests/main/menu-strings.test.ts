import { describe, expect, test } from 'vitest';
import { menuLabels } from '../../src/main/menu/menu-strings';
import { APP_LANGUAGES } from '../../src/shared/i18n';

describe('menuLabels', () => {
	test('substitutes the application name into the macOS entries', () => {
		const labels = menuLabels('ru', 'Ensemblr');
		expect(labels.about).toBe('О программе Ensemblr');
		expect(labels.hide).toBe('Скрыть Ensemblr');
		expect(labels.quit).toBe('Завершить Ensemblr');
	});

	test('leaves no unsubstituted placeholder in any language', () => {
		for (const language of APP_LANGUAGES) {
			for (const value of Object.values(menuLabels(language, 'Ensemblr'))) {
				expect(value).not.toContain('{{');
			}
		}
	});

	test('every language defines the same label set, none empty', () => {
		const english = Object.keys(menuLabels('en', 'Ensemblr')).sort();
		for (const language of APP_LANGUAGES) {
			const labels = menuLabels(language, 'Ensemblr');
			expect(Object.keys(labels).sort()).toEqual(english);
			for (const value of Object.values(labels)) {
				expect(value.length).toBeGreaterThan(0);
			}
		}
	});

	test('translates the role-item labels the menu overrides', () => {
		expect(menuLabels('el', 'Ensemblr').undo).toBe('Αναίρεση');
		expect(menuLabels('ru', 'Ensemblr').copy).toBe('Скопировать');
		expect(menuLabels('en', 'Ensemblr').closeTab).toBe('Close Tab');
	});
});
