import { accessSync, constants } from 'node:fs';
import { dirname } from 'node:path';
import { app, autoUpdater } from 'electron';
import { resolveBuildChannel } from '../../shared/build-channel';
import type { UpdateStatusSnapshot } from '../../shared/ipc/contracts/update';
import { relaunchOptions } from '../app/relaunch-target';
import {
	type AppImageInstaller,
	createAppImageInstaller,
} from './appimage-installer';
import { createReleaseFeed } from './release-feed';
import { checkUpdatePreconditions } from './update-preconditions';
import {
	createUpdateService,
	type UpdaterEventHandlers,
	type UpdateService,
} from './update-service';

/** Options for {@link createAppUpdateService}. */
export interface AppUpdateServiceOptions {
	/** Pushes each new snapshot to the renderer. */
	broadcast: (snapshot: UpdateStatusSnapshot) => void;
	/** Reads `app.general.automaticUpdates` at the moment of use. */
	isEnabled: () => boolean;
	/**
	 * Restarts into the staged update. Wired to the quit coordinator rather than
	 * to the installer directly: finishing an install issues its own `app.quit()`,
	 * which `before-quit` intercepts, so a direct call would have its relaunch
	 * discarded by the coordinator's plain quit re-issue.
	 */
	requestInstall: () => void;
}

/** The update service, plus the platform-specific end of a restart-to-install. */
export interface AppUpdateBinding {
	/**
	 * Ends a restart-to-install, once the agents are down. Hands off to Squirrel
	 * on darwin; on Linux it swaps the staged AppImage over the running one and
	 * relaunches. Owned here rather than by the caller so no platform branch has
	 * to live in the quit path.
	 */
	finishInstall: () => void;
	service: UpdateService;
}

/**
 * Binds the update service to Electron: the platform's installer, the running
 * app's channel and version, and the preconditions read off `app` and the
 * environment.
 * @param options - The renderer broadcast and the quit-guarded restart
 * @returns The service and the restart-to-install action, already aware of whether this build can update at all
 */
export function createAppUpdateService({
	broadcast,
	isEnabled,
	requestInstall,
}: AppUpdateServiceOptions): AppUpdateBinding {
	const channel = resolveBuildChannel(__ENSEMBLR_BUILD_CHANNEL__);
	const appImagePath = process.env.APPIMAGE || null;
	const preconditions = checkUpdatePreconditions({
		appImageDirectoryWritable:
			appImagePath !== null && isWritableDirectory(dirname(appImagePath)),
		appImagePath,
		channel,
		inApplicationsFolder: readIsInApplicationsFolder(),
		packaged: app.isPackaged,
		platform: process.platform,
	});

	// Built only where it can be used. Off Linux there is no AppImage to swap,
	// and on a Linux build that may not install there is nothing for it to do —
	// constructing one either way would leave a staging path pointing at a file
	// this build never writes.
	const appImageInstaller =
		process.platform === 'linux' &&
		preconditions.capability === 'install' &&
		appImagePath !== null
			? createAppImageInstaller({ appImagePath })
			: null;

	const service = createUpdateService({
		armUpdater: (candidate) => {
			if (appImageInstaller) {
				// Nothing to verify the download against, and an unverified AppImage
				// must not be renamed over the running one (ADR 0065).
				if (!candidate.linuxAsset) {
					return 'declined';
				}
				appImageInstaller.arm(candidate.linuxAsset, candidate.version);
				return 'armed';
			}
			autoUpdater.setFeedURL({ serverType: 'json', url: candidate.feedUrl });
			autoUpdater.checkForUpdates();
			return 'armed';
		},
		broadcast,
		channel,
		discardStaged: appImageInstaller
			? () => appImageInstaller.discardStaged()
			: undefined,
		getCurrentVersion: () => app.getVersion(),
		isEnabled,
		onUpdaterEvent: (handlers: UpdaterEventHandlers) => {
			if (appImageInstaller) {
				appImageInstaller.on(handlers);
				return;
			}
			autoUpdater.on('update-downloaded', () => handlers.onDownloaded());
			autoUpdater.on('update-not-available', () => handlers.onNotAvailable());
			autoUpdater.on('error', (error) => handlers.onError(error));
		},
		preconditions,
		releaseFeed: createReleaseFeed(),
		requestInstall,
	});

	return {
		finishInstall: () => finishInstall(appImageInstaller),
		service,
	};
}

/**
 * Completes a restart-to-install. On Linux the swap happens here, at the last
 * possible moment: a rename that fails leaves the running AppImage intact, so
 * relaunching regardless brings the user back on the version they already had
 * rather than into a half-replaced file.
 * @param appImageInstaller - The Linux installer, or null on a build Squirrel drives
 */
function finishInstall(appImageInstaller: AppImageInstaller | null): void {
	if (!appImageInstaller) {
		autoUpdater.quitAndInstall();
		return;
	}
	try {
		appImageInstaller.applyStaged();
	} catch (error) {
		console.warn('[updates] could not swap in the staged AppImage', error);
	}
	app.relaunch(relaunchOptions());
	app.quit();
}

/**
 * Reports whether a directory can be written to, which is what an AppImage swap
 * needs — it writes a sibling and renames over the running file. A throw means
 * no, which is the safe reading for a path that is missing as much as for one
 * that is read-only.
 * @param directory - The directory to test
 * @returns True when the process may create files in it
 */
function isWritableDirectory(directory: string): boolean {
	try {
		accessSync(directory, constants.W_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * Reads whether the bundle sits in an Applications folder, treating a throw as
 * "no" — the call is documented macOS-only and raises on a path Electron cannot
 * classify, and refusing to update is the safe reading of an unknown location.
 * The preconditions ignore it off darwin, so the `false` a Linux build gets
 * here never reaches a decision.
 * @returns True when the app can be replaced in place
 */
function readIsInApplicationsFolder(): boolean {
	try {
		return app.isInApplicationsFolder();
	} catch {
		return false;
	}
}
