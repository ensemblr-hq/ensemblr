import type { BrowserWindowConstructorOptions } from 'electron';

import {
	resolveWindowChrome,
	type TitleBarPreference,
	type WindowControlsOwner,
} from '../../shared/window-chrome.ts';

/**
 * The `BrowserWindow` options that decide who draws the title bar. These are
 * construct-time only — Electron offers no way to change `titleBarStyle` or
 * `frame` on a live window — which is why switching the setting asks for a
 * relaunch rather than applying in place.
 */
export type WindowChromeOptions = Pick<
	BrowserWindowConstructorOptions,
	'frame' | 'titleBarStyle' | 'trafficLightPosition'
>;

/**
 * The constructor options each control owner needs. Keyed by the shared
 * resolver's own verdict rather than by a second platform test, so a platform
 * that later starts drawing its own controls cannot end up with a
 * system-decorated window under Ensemblr's button cluster.
 */
const OPTIONS_BY_CONTROLS: Record<WindowControlsOwner, WindowChromeOptions> = {
	// No `titleBarOverlay`: with one, Chromium draws its own control cluster and
	// Ensemblr's would sit beside a second set of buttons.
	app: { titleBarStyle: 'hidden' },
	'system-frame': {},
	'system-inset': {
		titleBarStyle: 'hiddenInset',
		trafficLightPosition: { x: 14, y: 14 },
	},
};

/**
 * Maps the resolved chrome onto the constructor options that produce it. The
 * decision itself lives in `src/shared/window-chrome.ts`, which the renderer
 * reads too; this is only the Electron-shaped half.
 * @param platform - The running platform.
 * @param titleBar - The user's title-bar preference.
 * @returns Constructor options for the main window.
 */
export function resolveWindowChromeOptions(
	platform: NodeJS.Platform,
	titleBar: TitleBarPreference,
): WindowChromeOptions {
	return {
		...OPTIONS_BY_CONTROLS[resolveWindowChrome(platform, titleBar).controls],
	};
}
