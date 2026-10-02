/**
 * Builds the options `app.relaunch` needs to bring this build back up, which is
 * not always what Electron would pick for itself.
 *
 * `app.relaunch()` defaults to `process.execPath`, and inside an AppImage that
 * is the extracted binary under `/tmp/.mount_<random>/` — a FUSE mount the
 * AppImage runtime tears down the moment the process exits. Electron spawns the
 * replacement *after* that exit, so the default relaunches a path that no longer
 * exists and the app never comes back. The AppImage runtime exports the outer
 * `.AppImage` file's path as `APPIMAGE`, and that is the thing to run again.
 *
 * Everywhere else Electron's default is already right, so the result is empty
 * rather than handing `process.execPath` back to the function that would have
 * used it anyway.
 * @param env - Process environment to read `APPIMAGE` from
 * @returns Options to spread into the `app.relaunch` call
 */
export function relaunchOptions(env: NodeJS.ProcessEnv = process.env): {
	execPath?: string;
} {
	const appImage = env.APPIMAGE;
	return appImage && appImage.length > 0 ? { execPath: appImage } : {};
}
