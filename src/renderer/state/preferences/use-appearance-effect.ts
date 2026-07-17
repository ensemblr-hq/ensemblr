import { useAtomValue } from 'jotai';
import { useEffect } from 'react';

import {
	accessibleColorsAtom,
	codeLigaturesAtom,
	monoFontAtom,
} from './app-settings';

/** Bundled monospace family used by code, diffs, and terminal defaults. */
const BUNDLED_MONO_FONT = 'JetBrainsMono Nerd Font Mono';

/** Fallback monospace stack appended after the user's chosen font. */
const MONO_FALLBACK_STACK = `"${BUNDLED_MONO_FONT}", "JetBrains Mono Variable", "JetBrains Mono", Menlo, Consolas, monospace`;

/** Root classes for each non-default accessible-color variant. */
const A11Y_CLASSES = [
	'a11y-protanopia',
	'a11y-deuteranopia',
	'a11y-tritanopia',
] as const;

/**
 * Applies the non-theme appearance prefs to the document root as CSS custom
 * properties and root classes, so global surfaces react live without prop
 * threading: the mono font drives `--ensemblr-font-mono` (consumed by every
 * `font-mono` utility), ligatures toggle the `ligatures-off` class, and the
 * accessible-color variant swaps an `a11y-*` class that remaps status/diff
 * tokens. Mount once at the app root beside {@link useThemeEffect}.
 */
export function useAppearanceEffect(): void {
	const monoFont = useAtomValue(monoFontAtom);
	const ligatures = useAtomValue(codeLigaturesAtom);
	const accessibleColors = useAtomValue(accessibleColorsAtom);

	useEffect(() => {
		const font = monoFont.trim();
		const value =
			font && font !== BUNDLED_MONO_FONT
				? `"${font}", ${MONO_FALLBACK_STACK}`
				: MONO_FALLBACK_STACK;
		document.documentElement.style.setProperty('--ensemblr-font-mono', value);
	}, [monoFont]);

	useEffect(() => {
		document.documentElement.classList.toggle('ligatures-off', !ligatures);
	}, [ligatures]);

	useEffect(() => {
		const root = document.documentElement;
		root.classList.remove(...A11Y_CLASSES);
		if (accessibleColors !== 'default') {
			root.classList.add(`a11y-${accessibleColors}`);
		}
	}, [accessibleColors]);
}
