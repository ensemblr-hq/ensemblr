import path from 'node:path';

import { APP_NAMES } from '../../shared/build-channel.ts';

/**
 * Subdirectory Electron's own state goes in on Linux, inside Ensemblr's config
 * directory.
 *
 * Electron derives `userData` from the product name, so on Linux it lands at
 * `~/.config/Ensemblr` — one capital letter away from the `~/.config/ensemblr`
 * that holds `config.json` and `ensemblr.db`. Two adjacent directories differing
 * only in case reads as a bug, and the user cannot tell which one is theirs.
 * Nesting Electron's inside ours leaves one `ensemblr` directory whose top level
 * is only the two files a user ever opens.
 *
 * Named for what writes it. `sessionData` defaults to `userData`, so cookies,
 * Local Storage and Chromium's disk cache land here too — all of it Electron's,
 * none of it hand-editable.
 */
const ELECTRON_STATE_DIRECTORY = 'electron';

/**
 * Resolves where Electron should keep `userData`, or `null` to accept the
 * platform default.
 *
 * Two different problems, one per platform. On Linux it is the case-collision
 * above. On macOS `userData` lands in `~/Library/Application Support/<product
 * name>`, which no user browses, but the name follows the *channel* — so a
 * packaged Canary would open a blank window instead of the release's recents,
 * workspace selection and per-repository overrides. Pinning every packaged
 * build to the release's directory also puts them behind one single-instance
 * lock, which is the correct reading given they already share one database file
 * (this amends ADR 0032, whose bundle-id split stands).
 *
 * The Linux path needs no such pin: it is derived from the config directory,
 * which is channel-independent already, so the sharing falls out for free. The
 * unpackaged dev build gets its isolation from the dev config directory for the
 * same reason, which is why it is not excluded here the way macOS's is.
 * @param options - Platform, dev flag, Electron's `appData` path, and the resolved config file path for this build.
 * @returns The directory to pass to `app.setPath('userData', …)`, or null to leave Electron's default alone.
 */
export function resolveUserDataDirectory({
	appDataPath,
	configPath,
	isDev,
	platform,
}: {
	appDataPath: string;
	configPath: string;
	isDev: boolean;
	platform: NodeJS.Platform;
}): string | null {
	if (platform === 'linux') {
		return path.join(path.dirname(configPath), ELECTRON_STATE_DIRECTORY);
	}

	return isDev ? null : path.join(appDataPath, APP_NAMES.release);
}
