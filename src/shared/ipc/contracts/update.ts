import type { BuildChannel } from '../../build-channel';

/**
 * Machine-readable reasons an update check or install could not proceed. Every
 * one reaches the user — an update that fails silently is indistinguishable
 * from one that is simply not there yet.
 */
export type UpdateFailureCode =
	| 'update-download-failed'
	| 'update-feed-malformed'
	| 'update-feed-rate-limited'
	| 'update-feed-unreachable'
	| 'update-install-failed'
	| 'update-not-in-applications'
	| 'update-unsupported-build';

/** Typed failure envelope carried on an errored update status. */
export interface UpdateFailure {
	code: UpdateFailureCode;
	message: string;
}

/**
 * How far along the updater is.
 *
 * `unsupported` is terminal for the life of the process and is not a failure
 * the user can act on twice — an unpackaged or unsigned build can never update,
 * so the menu item reports it once rather than retrying on every tick.
 *
 * `disabled` is the same shape but the user's own doing, and reversible: they
 * turned `app.general.automaticUpdates` off because something else owns the
 * install. It is not a failure and carries none.
 */
export type UpdateState =
	| 'checking'
	| 'disabled'
	| 'downloading'
	| 'error'
	| 'idle'
	| 'ready'
	| 'unsupported';

/** Everything the renderer needs to render the update surfaces, in one payload. */
export interface UpdateStatusSnapshot {
	/** The release the app would install, once one is known to be newer. */
	availableVersion: string | null;
	/** Which release feed this build may update from; never crosses channels. */
	channel: BuildChannel;
	/** The running build's version, as `app.getVersion()` reports it. */
	currentVersion: string;
	failure: UpdateFailure | null;
	/** Release notes for `availableVersion`, when the feed carried any. */
	notes: string | null;
	state: UpdateState;
}

/** Broadcast from main whenever the update state machine advances. */
export interface UpdateStatusChangedBroadcast {
	snapshot: UpdateStatusSnapshot;
}

/** Renderer-facing surface of the in-app updater. */
export interface UpdateApi {
	/** Runs a check now, resolving with the state it left the updater in. */
	checkForUpdates: () => Promise<UpdateStatusSnapshot>;
	/**
	 * Restarts into a staged update. Goes through the quit guard, so a run with
	 * agents still working asks first and a refusal leaves the update staged.
	 */
	installUpdate: () => Promise<UpdateStatusSnapshot>;
	onUpdateStatusChanged: (
		listener: (event: UpdateStatusChangedBroadcast) => void,
	) => () => void;
	updateStatus: () => Promise<UpdateStatusSnapshot>;
}
