import { existsSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

import {
	APP_LINUX_APP_IDS,
	resolveBuildChannel,
} from '../../shared/build-channel.ts';

/**
 * Pixel size the window icon is loaded at. `_NET_WM_ICON` carries raw pixels
 * that every panel, switcher and window rule scales down itself, so one large
 * source beats a ladder of small ones; 512 is the largest `hicolor` size the
 * generator writes.
 */
const WINDOW_ICON_SIZE = 512;

/**
 * Basename of this build's freedesktop desktop entry, without the `.desktop`
 * suffix — the same per-channel id `forge.config.ts` hands the AppImage maker.
 * @returns The launcher id for the channel baked into this build
 */
function linuxDesktopEntryName(): string {
	return APP_LINUX_APP_IDS[resolveBuildChannel(__ENSEMBLR_BUILD_CHANNEL__)];
}

/**
 * Declares the app's Linux desktop identity, which Electron turns into the XDG
 * application id on Wayland and `WM_CLASS` on X11. Without it Electron guesses
 * a name from the executable — "Ensemblr Canary", space and all — which matches
 * no installed `.desktop` file, so the desktop environment cannot pair the
 * window with its icon and draws a generic one instead. A stable, per-channel
 * id is also what a window manager needs to key its own rules on. Must run
 * before `ready`; a no-op off Linux.
 */
export function applyLinuxDesktopIdentity(): void {
	if (process.platform !== 'linux') return;
	app.setDesktopName(`${linuxDesktopEntryName()}.desktop`);
}

/**
 * Absolute path to the PNG a Linux window carries as its own icon, so a window
 * shows the real mark even when the AppImage was never integrated into the
 * desktop's launcher and no `.desktop` file is installed to look one up in.
 * @returns The icon path, or undefined off Linux or when it was not packaged
 */
export function linuxWindowIconPath(): string | undefined {
	if (process.platform !== 'linux') return undefined;
	const iconFile = `icon-${WINDOW_ICON_SIZE}.png`;
	const iconPath = app.isPackaged
		? path.join(process.resourcesPath, 'icons', iconFile)
		: path.join(app.getAppPath(), 'assets', 'icons', iconFile);
	return existsSync(iconPath) ? iconPath : undefined;
}
