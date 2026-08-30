import { app, autoUpdater } from 'electron';

import { resolveBuildChannel } from '../../shared/build-channel';
import type { UpdateStatusSnapshot } from '../../shared/ipc/contracts/update';
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
	 * to `autoUpdater.quitAndInstall` directly: that call issues its own
	 * `app.quit()`, which `before-quit` intercepts, so a direct call would have
	 * its relaunch discarded by the coordinator's plain quit re-issue.
	 */
	requestInstall: () => void;
}

/**
 * Binds the update service to Electron: the real `autoUpdater`, the running
 * app's channel and version, and the preconditions read off `app`.
 * @param options - The renderer broadcast and the quit-guarded restart
 * @returns The service, already aware of whether this build can update at all
 */
export function createAppUpdateService({
	broadcast,
	isEnabled,
	requestInstall,
}: AppUpdateServiceOptions): UpdateService {
	const channel = resolveBuildChannel(__ENSEMBLR_BUILD_CHANNEL__);
	const preconditions = checkUpdatePreconditions({
		channel,
		inApplicationsFolder: readIsInApplicationsFolder(),
		packaged: app.isPackaged,
		platform: process.platform,
	});
	return createUpdateService({
		armUpdater: (feedUrl) => {
			autoUpdater.setFeedURL({ serverType: 'json', url: feedUrl });
			autoUpdater.checkForUpdates();
		},
		broadcast,
		channel,
		getCurrentVersion: () => app.getVersion(),
		isEnabled,
		onUpdaterEvent: (handlers: UpdaterEventHandlers) => {
			autoUpdater.on('update-downloaded', () => handlers.onDownloaded());
			autoUpdater.on('update-not-available', () => handlers.onNotAvailable());
			autoUpdater.on('error', (error) => handlers.onError(error));
		},
		preconditions,
		releaseFeed: createReleaseFeed(),
		requestInstall,
	});
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
