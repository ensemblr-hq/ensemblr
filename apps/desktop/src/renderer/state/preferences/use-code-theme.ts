import { useAtomValue } from 'jotai';
import type { BundledTheme } from 'shiki';

import {
	type ColorMode,
	useColorMode,
} from '@/renderer/hooks/preferences/use-color-mode';
import type { AppSettings } from '@/shared/ipc/contracts/app-settings';

import { codeThemeAtom } from './app-settings';

type CodeTheme = AppSettings['appearance']['codeTheme'];

/**
 * The light and dark cut of every syntax theme the Code theme setting offers.
 *
 * Settings stores one id, but a theme's palette is only legible against the
 * polarity it was designed for — Mocha's pastels wash out on a light panel, and
 * Latte's inks vanish on a dark one. Since the surface follows the app theme,
 * the picked id names a family and this table supplies the matching cut.
 */
export const CODE_THEME_FAMILIES = [
	{ dark: 'catppuccin-mocha', label: 'Catppuccin', light: 'catppuccin-latte' },
	{ dark: 'github-dark', label: 'GitHub', light: 'github-light' },
	{ dark: 'one-dark-pro', label: 'One', light: 'one-light' },
	{ dark: 'solarized-dark', label: 'Solarized', light: 'solarized-light' },
] as const satisfies readonly {
	dark: CodeTheme;
	label: string;
	light: BundledTheme;
}[];

/**
 * Finds the family a stored code-theme id belongs to, whichever cut was saved.
 * @param picked - The id held in Settings → Appearance → Code theme
 * @returns Its family, or the default family when the id is unknown
 */
function familyOf(picked: CodeTheme): (typeof CODE_THEME_FAMILIES)[number] {
	return (
		CODE_THEME_FAMILIES.find(
			(family) => family.dark === picked || family.light === picked,
		) ?? CODE_THEME_FAMILIES[0]
	);
}

/**
 * Normalizes a stored code-theme id to the one its family is keyed by, so the
 * settings picker can show a single entry per family.
 * @param picked - The id held in Settings → Appearance → Code theme
 * @returns The family's canonical id
 */
export function codeThemeFamilyId(picked: CodeTheme): CodeTheme {
	return familyOf(picked).dark;
}

/**
 * Picks the cut of the chosen syntax theme that suits the mode being painted.
 * @param picked - The id held in Settings → Appearance → Code theme
 * @param mode - The colour mode the app is painting in
 * @returns The Shiki theme to highlight with
 */
export function codeThemeForMode(
	picked: CodeTheme,
	mode: ColorMode,
): BundledTheme {
	const family = familyOf(picked);
	return mode === 'dark' ? family.dark : family.light;
}

/**
 * The syntax theme every highlighter in the app should use: the family picked
 * in Settings → Appearance → Code theme, in the app's current polarity.
 * @returns The Shiki theme to highlight with
 */
export function useResolvedCodeTheme(): BundledTheme {
	return codeThemeForMode(useAtomValue(codeThemeAtom), useColorMode());
}
