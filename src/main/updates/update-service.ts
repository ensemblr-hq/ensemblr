import type { BuildChannel } from '../../shared/build-channel';
import type { UpdateStatusSnapshot } from '../../shared/ipc/contracts/update';
import type { ReleaseFeed } from './release-feed';
import type { UpdatePreconditionResult } from './update-preconditions';

/**
 * How long after launch the first check runs. Long enough to stay out of the
 * startup path, short enough that a machine left open all day still catches the
 * night's build.
 */
const INITIAL_CHECK_DELAY_MS = 2 * 60 * 1000;

/**
 * Gap between periodic checks. The nightly publishes once a day and releases
 * far less often, so this is about six conditional requests a day against an
 * unauthenticated budget of sixty an hour.
 */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** Squirrel.Mac callbacks the service reacts to. */
export interface UpdaterEventHandlers {
	/** The staged update is on disk and a restart would install it. */
	onDownloaded: () => void;
	/** Squirrel could not download or stage the update. */
	onError: (error: Error) => void;
	/** Squirrel found nothing at the feed after all. */
	onNotAvailable: () => void;
}

/** Options for {@link createUpdateService}. */
export interface UpdateServiceOptions {
	/**
	 * Points Squirrel at a feed and starts the download. Throws on a build
	 * Squirrel refuses — an unsigned one, most often — which is the only honest
	 * signature check available without shelling out to `codesign`.
	 */
	armUpdater: (feedUrl: string) => void;
	/** Pushes each new snapshot to the renderer. */
	broadcast: (snapshot: UpdateStatusSnapshot) => void;
	/** The channel this build may update from; never crosses to another. */
	channel: BuildChannel;
	/** Reads the running build's version. */
	getCurrentVersion: () => string;
	/**
	 * Whether the user lets Ensemblr update itself
	 * (`app.general.automaticUpdates`). Read at the moment of use rather than
	 * captured, so a change takes effect without a restart. Off is a hard off:
	 * no scheduled check, no check the user asks for, and no install — an
	 * install a package manager owns must not be replaced behind its back.
	 */
	isEnabled: () => boolean;
	/** Registers the Squirrel listeners. Called once, from `start`. */
	onUpdaterEvent: (handlers: UpdaterEventHandlers) => void;
	/**
	 * How far this build may take an update, and why it may take none: `install`
	 * arms Squirrel, `check-only` stops at reporting the version, `none` never
	 * checks and carries the failure naming why. Taken whole rather than as a
	 * capability beside a failure, so no caller can pair one with the other's
	 * reason.
	 */
	preconditions: UpdatePreconditionResult;
	releaseFeed: ReleaseFeed;
	/**
	 * Restarts into the staged update. Goes through the quit guard, so agents
	 * mid-turn get their confirmation and a refusal leaves the update staged.
	 */
	requestInstall: () => void;
}

/** Public surface of the update service. */
export interface UpdateService {
	/** Runs a check now, resolving with the state it left the updater in. */
	checkNow: () => Promise<UpdateStatusSnapshot>;
	/** Restarts into a staged update; a no-op unless one is staged. */
	install: () => UpdateStatusSnapshot;
	/** The current snapshot, for the renderer's first read. */
	snapshot: () => UpdateStatusSnapshot;
	/** Arms the Squirrel listeners and starts the schedule. */
	start: () => void;
	/**
	 * Re-reads `isEnabled` after the user changed it, starting or stopping the
	 * schedule to match. Turning updates off also drops a staged update: Squirrel
	 * only ever applies one through `quitAndInstall`, which this service then
	 * never calls, so the staged bundle is inert.
	 */
	settingsChanged: () => void;
	/** Cancels the schedule. */
	stop: () => void;
}

/**
 * Builds the in-app updater.
 *
 * Squirrel.Mac does no version comparison of its own — whatever a feed hands it
 * gets installed — so this service decides first and arms Squirrel only once it
 * has established the candidate is strictly newer. Pointing Squirrel at a feed
 * is therefore the commitment to install, not the question.
 *
 * Every dependency is injected so this stays free of the `electron` import and
 * testable without a packaged app, the same way `app/quit-guard.ts` is.
 * @param options - The feed, the Squirrel port, and the surfaces to report to
 * @returns A service whose methods never throw
 */
export function createUpdateService(
	options: UpdateServiceOptions,
): UpdateService {
	/**
	 * The state to rest in when nothing is in flight: a build that can never
	 * update, one the user has switched off, or one waiting for its next check.
	 * @returns The resting state
	 */
	const restingState = (): UpdateStatusSnapshot['state'] => {
		if (options.preconditions.capability === 'none') {
			return 'unsupported';
		}
		return options.isEnabled() ? 'idle' : 'disabled';
	};

	let snapshot: UpdateStatusSnapshot = {
		availableVersion: null,
		channel: options.channel,
		currentVersion: options.getCurrentVersion(),
		failure: options.preconditions.failure,
		notes: null,
		releaseUrl: null,
		state: restingState(),
	};
	let initialTimer: NodeJS.Timeout | null = null;
	let intervalTimer: NodeJS.Timeout | null = null;

	/**
	 * Replaces the snapshot and tells the renderer. Every transition goes
	 * through here so no state change can reach one surface and miss the other.
	 * @param next - The fields that changed
	 * @returns The new snapshot
	 */
	const advance = (
		next: Partial<UpdateStatusSnapshot>,
	): UpdateStatusSnapshot => {
		snapshot = {
			...snapshot,
			currentVersion: options.getCurrentVersion(),
			...next,
		};
		options.broadcast(snapshot);
		return snapshot;
	};

	/**
	 * Wraps a Squirrel callback so it is dropped once the user has switched
	 * updates off. A download armed before the switch keeps running inside
	 * Squirrel and reports back afterwards, and letting that reach the snapshot
	 * would resurrect the offer `settingsChanged` just retracted — leaving a
	 * restart prompt whose button `install` then refuses.
	 * @param react - What the service does with the event while updates are on
	 * @returns The guarded handler
	 */
	const whileEnabled =
		<Args extends unknown[]>(react: (...args: Args) => void) =>
		(...args: Args): void => {
			if (options.isEnabled()) {
				react(...args);
			}
		};

	/** Stops the periodic check — nothing further to find, or nothing allowed. */
	const stopSchedule = (): void => {
		if (initialTimer) {
			clearTimeout(initialTimer);
			initialTimer = null;
		}
		if (intervalTimer) {
			clearInterval(intervalTimer);
			intervalTimer = null;
		}
	};

	/**
	 * Resolves the feed and, when it finds something strictly newer, arms
	 * Squirrel — which starts the download, because Squirrel has no separate
	 * "is there one" call.
	 * @returns The state the check left the updater in
	 */
	const checkNow = async (): Promise<UpdateStatusSnapshot> => {
		if (snapshot.state === 'unsupported') {
			return snapshot;
		}
		if (!options.isEnabled()) {
			return advance({
				availableVersion: null,
				failure: null,
				notes: null,
				releaseUrl: null,
				state: 'disabled',
			});
		}
		// A staged or in-flight download is already the newest thing this build
		// knows about; re-checking would only re-arm Squirrel over its own work.
		if (snapshot.state === 'checking' || snapshot.state === 'downloading') {
			return snapshot;
		}
		if (snapshot.state === 'ready') {
			return snapshot;
		}

		advance({ failure: null, state: 'checking' });
		const result = await options.releaseFeed.resolve(
			options.channel,
			options.getCurrentVersion(),
		);
		if (result.status === 'error') {
			return advance({ failure: result.failure, state: 'error' });
		}
		if (!result.candidate) {
			return advance({
				availableVersion: null,
				failure: null,
				notes: null,
				releaseUrl: null,
				state: 'idle',
			});
		}

		// A build that may not install stops here: it has named the newer version
		// and where to get it, and downloading a bundle it may not install would
		// only leave an unusable file on disk. Asked as "may it install" rather
		// than "is it check-only", so a capability added later reports the version
		// instead of arming Squirrel by default.
		if (options.preconditions.capability !== 'install') {
			return advance({
				availableVersion: result.candidate.version,
				failure: null,
				notes: result.candidate.notes,
				releaseUrl: result.candidate.releaseUrl,
				state: 'available',
			});
		}

		try {
			options.armUpdater(result.candidate.feedUrl);
		} catch (error) {
			return advance({
				failure: {
					code: 'update-unsupported-build',
					message: `Squirrel refused this build: ${String(error)}`,
				},
				state: 'error',
			});
		}
		return advance({
			availableVersion: result.candidate.version,
			failure: null,
			notes: result.candidate.notes,
			releaseUrl: result.candidate.releaseUrl,
			state: 'downloading',
		});
	};

	/**
	 * Arms the delayed first check and the interval after it. Separate from
	 * `start` because turning updates back on resumes the schedule without
	 * re-registering the Squirrel listeners.
	 */
	const startSchedule = (): void => {
		if (initialTimer || intervalTimer) {
			return;
		}
		initialTimer = setTimeout(() => {
			initialTimer = null;
			void checkNow();
			intervalTimer = setInterval(() => void checkNow(), CHECK_INTERVAL_MS);
		}, INITIAL_CHECK_DELAY_MS);
	};

	/**
	 * Registers the Squirrel listeners once and, when the user allows updates,
	 * starts the schedule. A build that can never update reports its reason and
	 * arms nothing.
	 */
	const start = (): void => {
		if (snapshot.state === 'unsupported') {
			options.broadcast(snapshot);
			return;
		}
		// A build that may not install never arms Squirrel, so there is nothing to
		// listen to — registering the handlers would only wire callbacks that
		// cannot fire.
		if (options.preconditions.capability !== 'install') {
			if (options.isEnabled()) {
				startSchedule();
			}
			options.broadcast(snapshot);
			return;
		}
		options.onUpdaterEvent({
			onDownloaded: whileEnabled(() => {
				stopSchedule();
				advance({ failure: null, state: 'ready' });
			}),
			onError: whileEnabled((error: Error) => {
				advance({
					failure: {
						code: 'update-download-failed',
						message: `The update could not be downloaded: ${error.message}`,
					},
					state: 'error',
				});
			}),
			onNotAvailable: whileEnabled(() => {
				advance({
					availableVersion: null,
					notes: null,
					releaseUrl: null,
					state: 'idle',
				});
			}),
		});
		if (options.isEnabled()) {
			startSchedule();
		}
		options.broadcast(snapshot);
	};

	/**
	 * Re-reads the automatic-updates setting and brings the schedule and the
	 * reported state into line with it.
	 */
	const settingsChanged = (): void => {
		if (snapshot.state === 'unsupported') {
			return;
		}
		if (!options.isEnabled()) {
			stopSchedule();
			if (snapshot.state !== 'disabled') {
				advance({
					availableVersion: null,
					failure: null,
					notes: null,
					releaseUrl: null,
					state: 'disabled',
				});
			}
			return;
		}
		if (snapshot.state === 'disabled') {
			advance({ failure: null, state: 'idle' });
			startSchedule();
			void checkNow();
		}
	};

	/**
	 * Restarts into a staged update, through the quit guard. A check-only build
	 * never reaches `ready`, so this is inert there and the surface links to
	 * `releaseUrl` instead.
	 * @returns The unchanged snapshot when nothing is staged, else the state the request left behind
	 */
	const install = (): UpdateStatusSnapshot => {
		if (snapshot.state !== 'ready' || !options.isEnabled()) {
			return snapshot;
		}
		try {
			options.requestInstall();
		} catch (error) {
			return advance({
				failure: {
					code: 'update-install-failed',
					message: `The restart into the update failed: ${String(error)}`,
				},
				state: 'error',
			});
		}
		return snapshot;
	};

	return {
		checkNow,
		install,
		settingsChanged,
		snapshot: () => snapshot,
		start,
		stop: stopSchedule,
	};
}
