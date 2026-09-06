import type { AppSettings } from '../../shared/config.ts';

/**
 * The colour Chromium shows wherever the page has not painted: the frame before
 * the renderer's first paint, a resize the compositor has not caught up with,
 * and any frame a busy renderer misses.
 *
 * These are the sRGB cuts of `--ensemblr-canvas` in
 * `src/renderer/styles/index.css` — the colour `html` itself paints — so a gap
 * reads as the app's own surface rather than as a flash of some other colour.
 * A near-black default was visible as the whole window blinking dark under a
 * light theme, which is what tied it to the palette.
 * `tests/main/window-background.test.ts` fails if the stylesheet moves and these
 * do not.
 */
const DARK_CANVAS = '#1c1716';

/** The light cut of `--ensemblr-canvas`. See {@link DARK_CANVAS}. */
const LIGHT_CANVAS = '#eff0f3';

/**
 * Picks the window background for the theme the app is about to paint in.
 *
 * The OS preference is passed in rather than read from `nativeTheme` here, so
 * the choice stays a pure function of the two inputs that decide it.
 * @param theme - The user's theme preference.
 * @param prefersDark - Whether the OS asks for dark colours, which decides `system`.
 * @returns The hex colour to construct or repaint the window with.
 */
export function resolveWindowBackgroundColor({
	prefersDark,
	theme,
}: {
	prefersDark: boolean;
	theme: AppSettings['appearance']['theme'];
}): string {
	if (theme === 'dark') {
		return DARK_CANVAS;
	}
	if (theme === 'light') {
		return LIGHT_CANVAS;
	}
	return prefersDark ? DARK_CANVAS : LIGHT_CANVAS;
}
