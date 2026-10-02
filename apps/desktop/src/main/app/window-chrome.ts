import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';

import { IPC_CHANNELS } from '../../shared/ipc/channels.ts';
import {
	resolveWindowChrome,
	type TitleBarPreference,
	type WindowChromeSnapshot,
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

/**
 * Keeps the live window's chrome current across full-screen transitions and
 * pushes each new snapshot to the renderer.
 *
 * Everything else about the chrome is fixed when the window is constructed, but
 * full screen is not: macOS slides its traffic lights off the window there, so
 * the leading inset reserved for them has to go with them and come back on the
 * way out. `onResolved` hands the caller the same snapshot, so the value the
 * bootstrap channel serves a reload cannot fall behind the one already pushed.
 * @param options - The window to follow, the user's title-bar preference, and where to record each resolved snapshot.
 */
export function trackWindowChrome({
	onResolved,
	titleBar,
	window,
}: {
	onResolved: (chrome: WindowChromeSnapshot) => void;
	titleBar: TitleBarPreference;
	window: BrowserWindow;
}): void {
	const publish = (): void => {
		if (window.isDestroyed() || window.webContents.isDestroyed()) {
			return;
		}

		const chrome = resolveWindowChrome(
			process.platform,
			titleBar,
			window.isFullScreen(),
		);
		onResolved(chrome);
		window.webContents.send(IPC_CHANNELS.windowChromeChanged, chrome);
	};

	window.on('enter-full-screen', publish);
	window.on('leave-full-screen', publish);
	// Preload seeds the bootstrap snapshot best-effort and exposes nothing if the
	// sync call throws, which would leave that renderer on its platform guess for
	// the page's lifetime. Republishing on load is what it recovers from.
	window.webContents.on('did-finish-load', publish);
}
