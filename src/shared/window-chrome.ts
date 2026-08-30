import type { AppearanceSettings } from './config.ts';

/** Which title bar a window wears: Ensemblr's own, or the desktop's. */
export type TitleBarPreference = AppearanceSettings['titleBar'];

/**
 * How much room the app's own content must leave along the window's edges, in
 * `rem`, so it clears whatever is drawn over or above it.
 */
export interface WindowChromeInsets {
	/** Leading edge: the macOS traffic lights. */
	start: number;
	/** Top edge: the title bar Ensemblr draws when it owns the controls. */
	top: number;
}

/**
 * Who draws the window's minimize / maximize / close buttons, and where they
 * sit relative to the app's own content.
 *
 * - `app` — Ensemblr draws them itself, in its own title bar above the app's
 *   content, over a frameless window.
 * - `system-inset` — the platform draws them *inside* the content area, as
 *   macOS does with the traffic lights, so the shell keeps the leading edge
 *   clear for them.
 * - `system-frame` — the desktop draws a title bar outside the content area and
 *   the app reserves nothing.
 *
 * This is the single decision the whole chrome follows from: the insets, the
 * `BrowserWindow` constructor options, and whether the renderer mounts a control
 * cluster are all derived from it rather than each re-testing the platform.
 */
export type WindowControlsOwner = 'app' | 'system-frame' | 'system-inset';

/**
 * What the running window's chrome actually is. Main resolves this once, when
 * it constructs the window, and hands the renderer the same answer — rather
 * than letting the renderer re-derive it from a setting that may have changed
 * since. The two must agree: a renderer that drew its controls over a
 * system-decorated window would stack two sets of buttons.
 */
export interface WindowChromeSnapshot {
	controls: WindowControlsOwner;
	/** Whether Ensemblr draws minimize / maximize / close itself. */
	drawsOwnControls: boolean;
	insets: WindowChromeInsets;
	titleBar: TitleBarPreference;
}

/**
 * Height of the title bar Ensemblr draws above its own content, in `rem`.
 *
 * Deliberately shorter than `--ensemblr-toolbar-height`: it carries the
 * wordmark and three buttons, and a strip as tall as the toolbars below it
 * would read as a second one. It reaches CSS as
 * `--ensemblr-window-chrome-inset-top`, which is both the strip's height and
 * the padding the shell clears it with, so the two cannot drift apart.
 */
const APP_TITLE_BAR_HEIGHT_REM = 2.25;

/** Width the macOS traffic lights occupy, in `rem`. */
export const TRAFFIC_LIGHT_INSET_REM = 5.75;

/** The room each control owner claims along the window's top edge, in `rem`. */
const INSETS_BY_CONTROLS: Record<WindowControlsOwner, WindowChromeInsets> = {
	app: { start: 0, top: APP_TITLE_BAR_HEIGHT_REM },
	'system-frame': { start: 0, top: 0 },
	'system-inset': { start: TRAFFIC_LIGHT_INSET_REM, top: 0 },
};

/**
 * Resolves the window chrome for a platform and the user's title-bar
 * preference.
 *
 * macOS ignores the preference: the traffic lights are the system's to draw, and
 * a frameless macOS window would lose them along with full-screen and the window
 * menu. Linux honours it, because there the frame belongs to the compositor and
 * a user whose compositor mishandles a frameless window needs a way back.
 * @param platform - The running platform.
 * @param titleBar - The user's title-bar preference.
 * @returns Who draws the controls, and the insets the shell must leave.
 */
export function resolveWindowChrome(
	platform: NodeJS.Platform | string,
	titleBar: TitleBarPreference,
): WindowChromeSnapshot {
	if (platform === 'darwin') {
		return describeWindowChrome('system-inset', titleBar);
	}

	if (platform === 'linux' && titleBar === 'custom') {
		return describeWindowChrome('app', titleBar);
	}

	return describeWindowChrome('system-frame', titleBar);
}

/**
 * Expands a control owner into the full snapshot, so `drawsOwnControls` and the
 * insets are computed in one place and cannot drift apart.
 * @param controls - Who draws the window controls.
 * @param titleBar - The user's title-bar preference.
 * @returns The snapshot both processes read.
 */
function describeWindowChrome(
	controls: WindowControlsOwner,
	titleBar: TitleBarPreference,
): WindowChromeSnapshot {
	return {
		controls,
		drawsOwnControls: controls === 'app',
		insets: { ...INSETS_BY_CONTROLS[controls] },
		titleBar,
	};
}

/**
 * Reports whether the title-bar setting is one the running platform reads at
 * all, so a settings row can hide itself where the choice has no effect.
 * @param platform - The running platform.
 * @returns True when the preference changes anything.
 */
export function supportsTitleBarPreference(
	platform: NodeJS.Platform | string,
): boolean {
	return platform === 'linux';
}
