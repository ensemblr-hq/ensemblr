// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, test } from 'vitest';

import {
	appSettingsAtom,
	useAppearanceEffect,
} from '../../src/renderer/state/preferences';
import {
	type AppearanceSettings,
	DEFAULT_APP_SETTINGS,
} from '../../src/shared/config/app-settings';

/** Mounts the effect under a store seeded with the given appearance overrides. */
function renderWithAppearance(appearance: Partial<AppearanceSettings>) {
	const store = createStore();
	store.set(appSettingsAtom, {
		...DEFAULT_APP_SETTINGS,
		appearance: { ...DEFAULT_APP_SETTINGS.appearance, ...appearance },
	});
	function Probe() {
		useAppearanceEffect();
		return null;
	}
	return render(
		<Provider store={store}>
			<Probe />
		</Provider>,
	);
}

afterEach(() => {
	document.documentElement.className = '';
	document.documentElement.style.removeProperty('--ensemblr-font-mono');
});

describe('useAppearanceEffect', () => {
	test('prepends the chosen mono font to the CSS var', () => {
		renderWithAppearance({ monoFont: 'Fira Code' });
		const value = document.documentElement.style.getPropertyValue(
			'--ensemblr-font-mono',
		);
		expect(value).toContain('"Fira Code"');
		expect(value).toContain('monospace');
	});

	test('falls back to the base stack when the font is blank', () => {
		renderWithAppearance({ monoFont: '   ' });
		const value = document.documentElement.style.getPropertyValue(
			'--ensemblr-font-mono',
		);
		expect(value.startsWith('"JetBrainsMono Nerd Font Mono"')).toBe(true);
	});

	test('adds ligatures-off only when ligatures are disabled', () => {
		renderWithAppearance({ codeLigatures: false });
		expect(document.documentElement.classList.contains('ligatures-off')).toBe(
			true,
		);
	});

	test('leaves ligatures on by default', () => {
		renderWithAppearance({ codeLigatures: true });
		expect(document.documentElement.classList.contains('ligatures-off')).toBe(
			false,
		);
	});

	test('applies the accessible-colors variant class', () => {
		renderWithAppearance({ accessibleColors: 'protanopia' });
		expect(document.documentElement.classList.contains('a11y-protanopia')).toBe(
			true,
		);
	});

	test('adds no a11y class for the default variant', () => {
		renderWithAppearance({ accessibleColors: 'default' });
		const hasA11y = [...document.documentElement.classList].some((cls) =>
			cls.startsWith('a11y-'),
		);
		expect(hasA11y).toBe(false);
	});
});
