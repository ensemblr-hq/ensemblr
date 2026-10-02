import type { BuildChannel } from '../../shared/build-channel';
import type {
	UpdateFailureCode,
	UpdateStatusSnapshot,
} from '../../shared/ipc/contracts/update';
import type { ReleaseFeed, UpdateCandidate } from './release-feed';
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

/**
 * Phrases the diagnostic an errored update carries, so a checksum that did not
 * match is not filed as a download that did not finish. Only the support bundle
 * reads this — the renderer draws its own copy from the code.
 * @param code - The failure the installer reported
 * @param error - What the installer reported it with
 * @returns The message to carry on the snapshot
 */
function describeUpdaterFailure(code: UpdateFailureCode, error: Error): string {
	if (code === 'update-verification-failed') {
		return `The update failed verification: ${error.message}`;
	}
	return `The update could not be downloaded: ${error.message}`;
}

/**
 * Callbacks a platform installer reports through. Named for Squirrel.Mac, whose
 * shape they follow, but the Linux AppImage installer drives the same three.
 */
export interface UpdaterEventHandlers {
	/** The staged update is on disk and a restart would install it. */
	onDownloaded: () => void;
	/**
	 * The update could not be downloaded or staged.
	 * @param error - What went wrong, for the support bundle
	 * @param code - The failure to report, when it is something more specific
	 * than a download that did not finish — a checksum that did not match, above
	 * all, which is not something waiting for the next check would fix
	 */
	onError: (error: Error, code?: UpdateFailureCode) => void;
	/** The installer found nothing after all. */
	onNotAvailable: () => void;
}

/**
 * Whether a platform installer took the candidate it was handed. `declined`
 * says this installer cannot install *this release* — a Linux release GitHub
 * published no digest for, so there is nothing to verify a download against —
 * which is a different thing from a build that cannot update at all, and is
 * reported as an offer to fetch by hand rather than as an error.
 */
export type ArmResult = 'armed' | 'declined';

/** Options for {@link createUpdateService}. */
export interface UpdateServiceOptions {
	/**
	 * Starts the download of a candidate this service has already established is
	 * newer. Takes the whole candidate because each platform installs from a
	 * different part of it — darwin points Squirrel at the feed document, Linux
	 * downloads the `.AppImage` and its checksum — and neither should have to
	 * know the other's field exists.
	 *
	 * Returns `declined` when the installer will not take this particular
	 * release, and throws only on a build the platform installer refuses
	 * outright — an unsigned one on darwin, which is the only honest signature
	 * check available without shelling out to `codesign`. Failures that surface
	 * mid-download come back through {@link UpdaterEventHandlers.onError}
	 * instead.
	 */
	armUpdater: (candidate: UpdateCandidate) => ArmResult;
	/** Pushes each new snapshot to the renderer. */
	broadcast: (snapshot: UpdateStatusSnapshot) => void;
	/** The channel this build may update from; never crosses to another. */
	channel: BuildChannel;
	/**
	 * Throws away a download staged but not yet applied, called whenever this
	 * service concludes there is nothing left to install — the user switched
	 * updates off, or a check found the build already current.
	 *
	 * ADR 0055 has switching off drop a staged update, and on darwin that costs
	 * nothing: Squirrel's staged bundle is inert once `quitAndInstall` is never
	 * called. A staged AppImage is a real ~120 MB file sitting beside the running
	 * one, so "inert" there has to mean deleted. Optional because Squirrel
	 * exposes no way to do it.
	 */
	discardStaged?: () => void;
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
	/** Registers the platform installer's listeners. Called once, from `start`. */
	onUpdaterEvent: (handlers: UpdaterEventHandlers) => void;
	/**
	 * How far this build may take an update, and why it may take none: `install`
	 * arms the platform installer, `check-only` stops at reporting the version,
	 * `none` never checks and carries the failure naming why. Taken whole rather
	 * than as a capability beside a failure, so no caller can pair one with the
	 * other's reason.
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
	/** Registers the installer's listeners and starts the schedule. */
	start: () => void;
	/**
	 * Re-reads `isEnabled` after the user changed it, starting or stopping the
	 * schedule to match. Turning updates off also drops a staged update: neither
	 * installer applies one without this service asking, which it then never
	 * does, and `discardStaged` deletes what is deletable.
	 */
	settingsChanged: () => void;
	/** Cancels the schedule. */
	stop: () => void;
}

/**
 * Builds the in-app updater.
 *
 * Neither installer compares versions of its own accord — Squirrel.Mac installs
 * whatever a feed hands it, and the AppImage installer downloads whatever asset
 * it is given — so this service decides first and arms one only once it has
 * established the candidate is strictly newer. Arming is therefore the
 * commitment to install, not the question.
 *
 * Every dependency is injected so this stays free of the `electron` import and
 * testable without a packaged app, the same way `app/quit-guard.ts` is.
 * @param options - The feed, the installer port, and the surfaces to report to
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
	 * Wraps an installer callback so it is dropped once the user has switched
	 * updates off. A download armed before the switch keeps running inside the
	 * installer and reports back afterwards, and letting that reach the snapshot
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
	 * Names a newer version and where to get it, without downloading anything.
	 * Both non-installing paths end here — a build that may not install at all,
	 * and an installer that declined this particular release — so the two cannot
	 * drift into reporting the same situation differently.
	 * @param candidate - The release to offer
	 * @returns The snapshot carrying the offer
	 */
	const offerWithoutInstalling = (
		candidate: UpdateCandidate,
	): UpdateStatusSnapshot =>
		advance({
			availableVersion: candidate.version,
			failure: null,
			notes: candidate.notes,
			releaseUrl: candidate.releaseUrl,
			state: 'available',
		});

	/**
	 * Resolves the feed and, when it finds something strictly newer, arms the
	 * platform installer — which starts the download, because neither installer
	 * has a separate "is there one" call.
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
		// knows about; re-checking would only re-arm the installer over its own work.
		if (snapshot.state === 'checking' || snapshot.state === 'downloading') {
			return snapshot;
		}
		if (snapshot.state === 'ready') {
			return snapshot;
		}

		// A feed that could not be read does not retract an offer already made: the
		// release page the user was sent to still works, and `error` would report a
		// download failure that never happened on a build that never downloads.
		const offerSurvivesFeedError = snapshot.state === 'available';
		advance({ failure: null, state: 'checking' });
		const result = await options.releaseFeed.resolve(
			options.channel,
			options.getCurrentVersion(),
		);
		if (result.status === 'error') {
			return advance({
				failure: result.failure,
				state: offerSurvivesFeedError ? 'available' : 'error',
			});
		}
		if (!result.candidate) {
			// Nothing newer to install, so anything staged is for a version this
			// build has since caught up with — installed by hand, or by the shell
			// updater. Keeping it would leave a stale copy nothing can ever apply.
			options.discardStaged?.();
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
		// instead of arming an installer by default.
		if (options.preconditions.capability !== 'install') {
			return offerWithoutInstalling(result.candidate);
		}

		let armed: ArmResult;
		try {
			armed = options.armUpdater(result.candidate);
		} catch (error) {
			return advance({
				failure: {
					code: 'update-unsupported-build',
					message: `The platform installer refused this build: ${String(error)}`,
				},
				state: 'error',
			});
		}
		if (armed === 'declined') {
			return offerWithoutInstalling(result.candidate);
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
	 * re-registering the installer's listeners.
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
	 * Registers the installer's listeners once and, when the user allows updates,
	 * starts the schedule. A build that can never update reports its reason and
	 * arms nothing.
	 */
	const start = (): void => {
		if (snapshot.state === 'unsupported') {
			options.broadcast(snapshot);
			return;
		}
		// A build that may not install never arms an installer, so there is nothing
		// to listen to — registering the handlers would only wire callbacks that
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
			onError: whileEnabled((error: Error, code?: UpdateFailureCode) => {
				const reported = code ?? 'update-download-failed';
				advance({
					failure: {
						code: reported,
						message: describeUpdaterFailure(reported, error),
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
				options.discardStaged?.();
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
