import type { BuildChannel } from '../../shared/build-channel';
import type { UpdateFailure } from '../../shared/ipc/contracts/update';

/** What {@link checkUpdatePreconditions} needs to know about the running build. */
export interface UpdatePreconditionInputs {
	/**
	 * Path of the running `.AppImage`, from `process.env.APPIMAGE`, or null when
	 * the variable is unset. Unset means the build is not running as an AppImage
	 * at all — an extracted run, or one started from a packaged directory — and
	 * there is no single file to swap.
	 */
	appImagePath: string | null;
	/**
	 * Whether the directory holding the running AppImage can be written to. The
	 * swap writes a sibling and renames over it, so directory permission is what
	 * decides it, not permission on the file.
	 */
	appImageDirectoryWritable: boolean;
	/** The channel this build was cut on. */
	channel: BuildChannel;
	/** Whether the `.app` lives in `/Applications`, per `app.isInApplicationsFolder()`. */
	inApplicationsFolder: boolean;
	/** Whether this is a packaged build, per `app.isPackaged`. */
	packaged: boolean;
	/** The platform, which decides both the installer and whether there is one. */
	platform: NodeJS.Platform;
}

/**
 * How far this build may take an update.
 *  - `install` — the download may be staged and the app restarted into it.
 *  - `check-only` — the feed may be read and a newer version reported, but the
 *    install belongs to whoever put the file there: an AppImage on a read-only
 *    or immutable filesystem, or a build not running from an AppImage at all.
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
	appImageDirectoryWritable,
	appImagePath,
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
	// An AppImage replaces itself by writing a sibling and renaming over its own
	// path, so both facts have to hold: the app has to know which file it is
	// running as, and it has to be able to write the directory that file sits in.
	// An immutable image, a read-only mount, or a root-owned `/opt` all land here
	// and link at the release page instead — a refusal the user can act on,
	// rather than a swap that fails halfway.
	if (platform === 'linux') {
		const installable = appImagePath !== null && appImageDirectoryWritable;
		return {
			capability: installable ? 'install' : 'check-only',
			failure: null,
		};
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
