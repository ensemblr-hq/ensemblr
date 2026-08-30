import type { AppearanceSettings } from './config.ts';

/** Which title bar a window wears: Ensemblr's own, or the desktop's. */
export type TitleBarPreference = AppearanceSettings['titleBar'];

/**
 * How much room the app's own chrome must leave along the window's top edge, in
 * `rem`, so the toolbar clears whatever the platform draws there.
 */
export interface WindowChromeInsets {
	/** Trailing edge: Ensemblr's own window controls, when it draws them. */
	end: number;
	/** Leading edge: the macOS traffic lights. */
	start: number;
}

/**
 * What the running window's chrome actually is. Main resolves this once, when
 * it constructs the window, and hands the renderer the same answer — rather
 * than letting the renderer re-derive it from a setting that may have changed
 * since. The two must agree: a renderer that drew its controls over a
 * system-decorated window would stack two sets of buttons.
 */
export interface WindowChromeSnapshot {
	/** Whether Ensemblr draws minimize / maximize / close itself. */
	drawsOwnControls: boolean;
	insets: WindowChromeInsets;
	titleBar: TitleBarPreference;
}

/** Width the app's own three-button control cluster occupies, in `rem`. */
export const APP_WINDOW_CONTROLS_INSET_REM = 7;

/** Width the macOS traffic lights occupy, in `rem`. */
export const TRAFFIC_LIGHT_INSET_REM = 5.75;

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
		return {
			drawsOwnControls: false,
			insets: { end: 0, start: TRAFFIC_LIGHT_INSET_REM },
			titleBar,
		};
	}

	if (platform === 'linux' && titleBar === 'custom') {
		return {
			drawsOwnControls: true,
			insets: { end: APP_WINDOW_CONTROLS_INSET_REM, start: 0 },
			titleBar,
		};
	}

	return {
		drawsOwnControls: false,
		insets: { end: 0, start: 0 },
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
