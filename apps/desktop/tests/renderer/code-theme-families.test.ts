import { describe, expect, test } from 'vitest';

import {
	codeThemeFamilyId,
	codeThemeForMode,
} from '../../src/renderer/state/preferences/use-code-theme';

describe('codeThemeForMode', () => {
	test('keeps a dark cut in dark mode', () => {
		expect(codeThemeForMode('catppuccin-mocha', 'dark')).toBe(
			'catppuccin-mocha',
		);
	});

	test('swaps a dark cut for its light sibling in light mode', () => {
		expect(codeThemeForMode('catppuccin-mocha', 'light')).toBe(
			'catppuccin-latte',
		);
		expect(codeThemeForMode('one-dark-pro', 'light')).toBe('one-light');
		expect(codeThemeForMode('solarized-dark', 'light')).toBe('solarized-light');
	});

	test('swaps a stored light cut for its dark sibling in dark mode', () => {
		expect(codeThemeForMode('github-light', 'dark')).toBe('github-dark');
		expect(codeThemeForMode('catppuccin-latte', 'dark')).toBe(
			'catppuccin-mocha',
		);
	});

	test('falls back to the first family for an id no longer offered', () => {
		expect(
			codeThemeForMode(
				'nord' as Parameters<typeof codeThemeForMode>[0],
				'dark',
			),
		).toBe('catppuccin-mocha');
	});
});

describe('codeThemeFamilyId', () => {
	test('normalizes either cut to the id the picker lists', () => {
		expect(codeThemeFamilyId('catppuccin-latte')).toBe('catppuccin-mocha');
		expect(codeThemeFamilyId('github-light')).toBe('github-dark');
		expect(codeThemeFamilyId('github-dark')).toBe('github-dark');
	});
});
