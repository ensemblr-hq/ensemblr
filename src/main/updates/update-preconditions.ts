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
 * Decides whether this build may update itself at all, naming the reason when
 * it may not.
 *
 * Every refusal here is permanent for the life of the process — none of the
 * four inputs can change while the app runs — so the updater reports it once
 * and stops checking rather than failing on every tick.
 * @param inputs - Facts about the running build
 * @returns A coded failure, or null when the build may update
 */
export function checkUpdatePreconditions({
	channel,
	inApplicationsFolder,
	packaged,
	platform,
}: UpdatePreconditionInputs): UpdateFailure | null {
	if (platform !== 'darwin') {
		return {
			code: 'update-unsupported-build',
			message: `In-app updates are macOS-only; this build runs on ${platform}.`,
		};
	}
	if (!packaged) {
		return {
			code: 'update-unsupported-build',
			message:
				'A development build updates by rebuilding it, not through Squirrel.',
		};
	}
	// `make:dev` is a local dogfood build with no published releases behind it,
	// so there is no feed for it to read — unlike canary, which the nightly
	// workflow publishes.
	if (channel === 'dev') {
		return {
			code: 'update-unsupported-build',
			message: 'The dev channel publishes no releases to update from.',
		};
	}
	// Squirrel replaces the whole bundle in place, which a read-only DMG mount
	// cannot support. Failing here names the fix; failing later looks like a
	// broken updater.
	if (!inApplicationsFolder) {
		return {
			code: 'update-not-in-applications',
			message:
				'Ensemblr updates itself only from /Applications. Move it there and reopen it.',
		};
	}
	return null;
}
