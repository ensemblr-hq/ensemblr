import { describe, expect, test } from 'vitest';
import { aboutPanelStrings } from '../../src/main/menu/about-panel-strings';
import { APP_LANGUAGES } from '../../src/shared/i18n';

describe('aboutPanelStrings', () => {
	test('every language defines the same key set, none empty', () => {
		const english = Object.keys(aboutPanelStrings('en')).sort();
		for (const language of APP_LANGUAGES) {
			const strings = aboutPanelStrings(language);
			expect(Object.keys(strings).sort()).toEqual(english);
			for (const value of Object.values(strings)) {
				expect(value.length).toBeGreaterThan(0);
			}
		}
	});

	test('keeps the inspiration placeholder and leaves no other one behind', () => {
		for (const language of APP_LANGUAGES) {
			const { inspiredBy, ...rest } = aboutPanelStrings(language);
			expect(inspiredBy).toContain('{{name}}');
			for (const value of Object.values(rest)) {
				expect(value).not.toContain('{{');
			}
		}
	});

	test('translates the group headings', () => {
		expect(aboutPanelStrings('ru').developmentTools).toBe(
			'Инструменты разработки',
		);
		expect(aboutPanelStrings('el').developmentTools).toBe('Εργαλεία ανάπτυξης');
		expect(aboutPanelStrings('en').coreProjects).toBe(
			'Core open-source projects',
		);
	});

	// The panel credits 49 direct dependencies out of the ~537 packages the
	// production tree resolves to, so a heading claiming the list is everything
	// the app bundles would be the only false line on the surface.
	test('claims a core rather than the whole bundle', () => {
		for (const language of APP_LANGUAGES) {
			expect(aboutPanelStrings(language).coreProjects).not.toMatch(
				/bundled|встроенн|ενσωματωμ/i,
			);
		}
	});

	test('falls back to English for an unrecognised language', () => {
		// A settings value outside the union can only arrive from a hand-edited
		// config; the cast reproduces that without weakening the public type.
		const strings = aboutPanelStrings('kl' as never);
		expect(strings).toEqual(aboutPanelStrings('en'));
	});
});
