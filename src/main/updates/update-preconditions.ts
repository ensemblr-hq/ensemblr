import type { BuildChannel } from '../../shared/build-channel';
import type { UpdateFailure } from '../../shared/ipc/contracts/update';

/** What {@link checkUpdatePreconditions} needs to know about the running build. */
export interface UpdatePreconditionInputs {
	/** The channel this build was cut on. */
	channel: BuildChannel;
	/** Whether the `.app` lives in `/Applications`, per `app.isInApplicationsFolder()`. */
	inApplicationsFolder: boolean;
	/** Whether this is a packaged build, per `app.isPackaged`. */
	packaged: boolean;
	/** The platform, so a non-darwin build refuses rather than arming Squirrel.Mac. */
	platform: NodeJS.Platform;
}

/**
 * How far this build may take an update.
 *  - `install` — Squirrel may be armed and the app restarted into the download.
 *  - `check-only` — the feed may be read and a newer version reported, but the
 *    install belongs to whoever put the file there. An AppImage is a single file
 *    the user placed themselves, often on a read-only or immutable filesystem,
 *    and Squirrel is macOS-only regardless.
 *  - `none` — the build may not update at all; `failure` names why.
 */
export type UpdateCapability = 'check-only' | 'install' | 'none';

/** What a build may do about updates, and why it may not do more. */
export interface UpdatePreconditionResult {
	capability: UpdateCapability;
	failure: UpdateFailure | null;
}

/**
 * Decides how far this build may take an update, naming the reason when it may
 * take none.
 *
 * Every refusal here is permanent for the life of the process — none of the
 * four inputs can change while the app runs — so the updater reports it once
 * and stops checking rather than failing on every tick.
 * @param inputs - Facts about the running build
 * @returns The capability, plus a coded failure when it is `none`
 */
export function checkUpdatePreconditions({
	channel,
	inApplicationsFolder,
	packaged,
	platform,
}: UpdatePreconditionInputs): UpdatePreconditionResult {
	if (platform !== 'darwin' && platform !== 'linux') {
		return refused(
			'update-unsupported-build',
			`In-app updates are unavailable on ${platform}.`,
		);
	}
	if (!packaged) {
		return refused(
			'update-unsupported-build',
			'A development build updates by rebuilding it, not through the updater.',
		);
	}
	// `make:dev` is a local dogfood build with no published releases behind it,
	// so there is no feed for it to read — unlike canary, which the nightly
	// workflow publishes.
	if (channel === 'dev') {
		return refused(
			'update-unsupported-build',
			'The dev channel publishes no releases to update from.',
		);
	}
	if (platform === 'linux') {
		return { capability: 'check-only', failure: null };
	}
	// Squirrel replaces the whole bundle in place, which a read-only DMG mount
	// cannot support. Failing here names the fix; failing later looks like a
	// broken updater.
	if (!inApplicationsFolder) {
		return refused(
			'update-not-in-applications',
			'Ensemblr updates itself only from /Applications. Move it there and reopen it.',
		);
	}
	return { capability: 'install', failure: null };
}

/**
 * Builds the refusal shape, so every branch above reads as one line.
 * @param code - The failure category
 * @param message - English prose for the support bundle; the renderer translates the code
 * @returns A `none` capability carrying that failure
 */
function refused(
	code: UpdateFailure['code'],
	message: string,
): UpdatePreconditionResult {
	return { capability: 'none', failure: { code, message } };
}
