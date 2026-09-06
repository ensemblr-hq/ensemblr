import type {
	UpdateFailureCode,
	UpdateState,
	UpdateStatusSnapshot,
} from '@/shared/ipc/contracts/update';

/** The build the fixtures pretend to be running. */
const CURRENT_VERSION = '0.1.0-beta.22';

/** The build the fixtures pretend the feed is offering. */
const AVAILABLE_VERSION = '0.1.0-beta.23';

/** Where a check-only build would send the user for the offered build. */
const RELEASE_URL =
	'https://github.com/ensemblr-hq/ensemblr/releases/tag/v0.1.0-beta.23';

/**
 * Builds one updater snapshot without restating the six fields every state
 * shares, so a scene row reads as the difference it is demonstrating.
 * @param state - The updater state to render
 * @param overrides - Fields this row needs to differ on
 * @returns A snapshot the panel can be driven with
 */
function snapshot(
	state: UpdateState,
	overrides: Partial<UpdateStatusSnapshot> = {},
): UpdateStatusSnapshot {
	return {
		availableVersion: AVAILABLE_VERSION,
		channel: 'release',
		currentVersion: CURRENT_VERSION,
		failure: null,
		notes: null,
		releaseUrl: RELEASE_URL,
		state,
		...overrides,
	};
}

/**
 * Builds an errored snapshot carrying one coded failure, which the panel shows
 * through the same `failureText` mapper the rest of the app uses.
 * @param code - The update failure code to report
 * @param message - The English sentence main would have sent alongside it
 * @returns An errored snapshot with a version already offered
 */
function failed(
	code: UpdateFailureCode,
	message: string,
): UpdateStatusSnapshot {
	return snapshot('error', { failure: { code, message } });
}

/** Every updater state the sidebar panel has to look right in, plus the four it must stay out of. */
export const UPDATE_PANEL_SNAPSHOTS: readonly {
	label: string;
	note: string;
	snapshot: UpdateStatusSnapshot;
}[] = [
	{
		label: 'ready',
		note: 'the staged build — the only state whose button finishes the job',
		snapshot: snapshot('ready'),
	},
	{
		label: 'downloading',
		note: 'no action yet; the panel is reporting, not asking',
		snapshot: snapshot('downloading'),
	},
	{
		label: 'available — check-only build',
		note: 'Linux and any copy outside /Applications: the version is known, the install is not this app’s',
		snapshot: snapshot('available'),
	},
	{
		label: 'available, after a re-check the feed refused',
		note: 'a feed error does not retract an offer already made — main stays on `available` and the release page still works',
		snapshot: snapshot('available', {
			failure: {
				code: 'update-feed-unreachable',
				message: 'The release feed could not be reached.',
			},
		}),
	},
	{
		label: 'error, with a version already offered',
		note: 'the download failed on an offer the user has already seen, so the panel stays and retries',
		snapshot: failed(
			'update-download-failed',
			'The update could not be downloaded: socket hang up',
		),
	},
	{
		label: 'idle — no panel',
		note: 'up to date; the sidebar footer shows nothing at all',
		snapshot: snapshot('idle', {
			availableVersion: null,
			releaseUrl: null,
		}),
	},
	{
		label: 'disabled — no panel',
		note: 'the other exit: automatic updates switched off in Settings → General',
		snapshot: snapshot('disabled', {
			availableVersion: null,
			releaseUrl: null,
		}),
	},
	{
		label: 'error, with no version — no panel',
		note: 'a laptop off wifi errors every few hours; a panel that cannot be dismissed must not be raised by this',
		snapshot: snapshot('error', {
			availableVersion: null,
			failure: {
				code: 'update-feed-unreachable',
				message: 'The release feed could not be reached.',
			},
			releaseUrl: null,
		}),
	},
	{
		label: 'unsupported — no panel',
		note: 'an unpackaged or unsigned build can never update, and says so once in Settings instead',
		snapshot: snapshot('unsupported', {
			availableVersion: null,
			failure: {
				code: 'update-not-in-applications',
				message: 'Ensemblr is not running from /Applications.',
			},
			releaseUrl: null,
		}),
	},
];
