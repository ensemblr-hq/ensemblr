import { access, constants } from 'node:fs/promises';

import type { LocalCommandService } from '../commands/index.ts';
import { resolveLinuxLauncher } from './linux-app-discovery.ts';
import {
	isValidBundleId,
	OPEN_TARGET_REGISTRY,
	resolvePlatformBehavior,
} from './open-target-registry.ts';

// Cold-boot Spotlight under ~18 concurrent probes routinely blows past 3s, and a
// timed-out probe is indistinguishable from "app absent" — so a stingy timeout
// silently drops installed editors. Give each probe generous headroom.
const MDFIND_TIMEOUT_MS = 8000;
const MDFIND_PATH = '/usr/bin/mdfind';

/** Known absolute paths for macOS system apps that mdfind sometimes hides. */
const BUILTIN_APP_PATHS: Readonly<Record<string, readonly string[]>> = {
	finder: ['/System/Library/CoreServices/Finder.app'],
	terminal: [
		'/System/Applications/Utilities/Terminal.app',
		'/Applications/Utilities/Terminal.app',
	],
};

/**
 * Per-target detection result: installed flag plus, when found, the absolute
 * `.app` path so callers can fetch a real icon for it.
 */
interface DetectedTarget {
	appPath: string | null;
	installed: boolean;
}

/** Map of registry id → detection result. */
export type DetectedTargetsMap = Readonly<Record<string, DetectedTarget>>;

/**
 * Outcome of a full detection pass. `degraded` marks a result that may be
 * hiding installed apps and must not be trusted as the authoritative installed
 * set: on macOS a bundle-id target whose `mdfind` probe failed (timeout, spawn
 * error) rather than genuinely returning "not installed"; on Linux a
 * login-shell probe that fell back, leaving detection to sweep the launcher's
 * own PATH and `XDG_DATA_DIRS` instead of the user's.
 */
export interface DetectionResult {
	degraded: boolean;
	detected: DetectedTargetsMap;
}

/**
 * Outcome of probing a single bundle id via Spotlight. `error` marks a transient
 * command failure (timeout, spawn error) that must never be conflated with a
 * genuine `not-found`, since doing so caches a temporarily-unreachable app as
 * uninstalled.
 */
type BundleProbeResult =
	| { status: 'found'; appPath: string }
	| { status: 'not-found' }
	| { status: 'error' };

/**
 * Probes which registered targets exist on this host, using whichever mechanism
 * the platform declares: Spotlight bundle ids on macOS, PATH lookups and
 * `.desktop` scans on Linux. A target that declares no behaviour for the
 * running platform is reported as absent rather than omitted, so callers can
 * still look it up by id.
 *
 * On macOS this is one `mdfind` call per bundle id, parallelised. Builtins fall
 * back to a small list of known system paths since mdfind can omit
 * Apple-shipped apps when the Spotlight index has not been built for those
 * system volumes.
 * @param options - The command runner used to invoke `mdfind`.
 * @returns The per-target detection map plus a `degraded` flag when any probe
 * failed transiently.
 */
export async function detectInstalledTargets({
	localCommandService,
}: {
	localCommandService: LocalCommandService;
}): Promise<DetectionResult> {
	const detected: Record<string, DetectedTarget> = {};

	for (const definition of OPEN_TARGET_REGISTRY) {
		detected[definition.id] = { appPath: null, installed: false };
	}

	// A packaged app inherits the launcher's PATH and XDG_DATA_DIRS, not the
	// user's login-shell ones, so an editor under `~/.local/bin` or a data dir
	// added by `/etc/profile.d` is invisible without this. Detection and dispatch
	// read the same snapshot or they disagree about which apps exist. The lookup
	// is already cached by the command service.
	const shell =
		process.platform === 'linux'
			? await resolveShellEnvironment(localCommandService)
			: null;
	let degraded = shell?.probeFailed ?? false;

	await Promise.all(
		OPEN_TARGET_REGISTRY.map(async (definition) => {
			const behavior = resolvePlatformBehavior(definition, process.platform);

			if (!behavior) {
				return;
			}

			switch (behavior.detection.kind) {
				case 'utility':
					detected[definition.id] = { appPath: null, installed: true };
					return;
				case 'builtin': {
					const path = await resolveBuiltinAppPath(definition.id);
					detected[definition.id] = {
						appPath: path,
						installed: path !== null,
					};
					return;
				}
				case 'linux-app': {
					await yieldToEventLoop();
					detected[definition.id] = {
						appPath: null,
						installed:
							resolveLinuxLauncher(behavior.detection, {
								env: shell?.env,
								pathValue: shell?.path ?? '',
							}) !== null,
					};
					return;
				}
				case 'bundleId': {
					const resolution = await findFirstInstalledAppPath({
						bundleIds: behavior.detection.bundleIds,
						localCommandService,
					});
					detected[definition.id] = {
						appPath: resolution.appPath,
						installed: resolution.appPath !== null,
					};
					if (resolution.appPath === null && resolution.errored) {
						degraded = true;
					}
				}
			}
		}),
	);

	return { degraded, detected };
}

/**
 * Yields to the event loop so each Linux target's synchronous filesystem sweep
 * lands in its own turn. Twenty-one targets probed back to back is roughly two
 * thousand blocking syscalls in one tick, right after `app.whenReady` — enough
 * to stall first paint on a host with a slow `$HOME`.
 * @returns A promise resolved on the next event-loop turn.
 */
function yieldToEventLoop(): Promise<void> {
	return new Promise((resolve) => {
		setImmediate(resolve);
	});
}

/** The login-shell environment detection resolved, and whether it is trustworthy. */
interface ShellEnvironment {
	env: Record<string, string>;
	path: string;
	probeFailed: boolean;
}

/**
 * Reads the login-shell environment, falling back to the process environment
 * when the probe fails or returns its own fallback, so detection degrades to
 * fewer hits rather than none. A fallback is reported so the caller can mark the
 * pass degraded instead of caching a short list as authoritative.
 * @param localCommandService - Service that resolves the login-shell environment.
 * @returns The environment to resolve launchers against, plus the probe's health.
 */
async function resolveShellEnvironment(
	localCommandService: LocalCommandService,
): Promise<ShellEnvironment> {
	try {
		const environment = await localCommandService.getEnvironment();
		const probeFailed = environment.source !== 'shell' || !environment.path;
		return {
			env: probeFailed ? processEnvironment() : environment.env,
			path: environment.path || (process.env.PATH ?? ''),
			probeFailed,
		};
	} catch {
		return {
			env: processEnvironment(),
			path: process.env.PATH ?? '',
			probeFailed: true,
		};
	}
}

/**
 * Narrows `process.env` to the defined entries a launcher resolution can read.
 * @returns The process environment with no undefined values.
 */
function processEnvironment(): Record<string, string> {
	return Object.fromEntries(
		Object.entries(process.env).filter(
			(entry): entry is [string, string] => entry[1] !== undefined,
		),
	);
}

/**
 * Resolve a builtin macOS app to the first of its known paths that exists.
 * @param id - Registry id of the builtin target.
 * @returns The existing `.app` path, or null when none is present.
 */
async function resolveBuiltinAppPath(id: string): Promise<string | null> {
	const candidates = BUILTIN_APP_PATHS[id] ?? [];
	for (const candidate of candidates) {
		if (await pathExists(candidate)) {
			return candidate;
		}
	}
	return null;
}

/**
 * Return the path of the first installed app among the candidate bundle ids.
 * A candidate that is `found` wins immediately; otherwise `errored` reports
 * whether any probe failed transiently, so the caller can tell "genuinely
 * absent" apart from "temporarily unreachable".
 * @param options - Candidate bundle ids and the command runner.
 * @returns The first matching `.app` path (or null) plus an `errored` flag set
 * when no candidate was found and at least one probe failed transiently.
 */
async function findFirstInstalledAppPath({
	bundleIds,
	localCommandService,
}: {
	bundleIds: readonly string[];
	localCommandService: LocalCommandService;
}): Promise<{ appPath: string | null; errored: boolean }> {
	let errored = false;
	for (const bundleId of bundleIds) {
		const probe = await mdfindPathForBundleId({
			bundleId,
			localCommandService,
		});
		if (probe.status === 'found') {
			return { appPath: probe.appPath, errored: false };
		}
		if (probe.status === 'error') {
			errored = true;
		}
	}
	return { appPath: null, errored };
}

/**
 * Electron exposes `app.getApplicationInfoForProtocol` and similar APIs but no
 * direct "find by bundle id". `mdfind` is the canonical Launch Services hook;
 * this thin wrapper reports whether the bundle was found, genuinely absent, or
 * unreachable because the probe itself failed.
 * @param options - The bundle id to probe and the command runner.
 * @returns A discriminated probe result.
 */
async function mdfindPathForBundleId({
	bundleId,
	localCommandService,
}: {
	bundleId: string;
	localCommandService: LocalCommandService;
}): Promise<BundleProbeResult> {
	// Registry is asserted at module load, but defence in depth: anything that
	// reaches the Spotlight predicate must already be a strict reverse-DNS id,
	// so no shell/predicate escaping is required.
	if (!isValidBundleId(bundleId)) {
		return { status: 'not-found' };
	}

	try {
		const result = await localCommandService.run(
			{
				args: [`kMDItemCFBundleIdentifier == "${bundleId}"`],
				command: MDFIND_PATH,
				timeoutMs: MDFIND_TIMEOUT_MS,
			},
			undefined,
		);

		if (result.status !== 'success') {
			return { status: 'error' };
		}

		const firstLine = result.stdout
			.split('\n')
			.map((line) => line.trim())
			.find((line) => line.length > 0);

		return firstLine
			? { status: 'found', appPath: firstLine }
			: { status: 'not-found' };
	} catch {
		return { status: 'error' };
	}
}

/**
 * Check whether a filesystem path exists.
 * @param path - Absolute path to test.
 * @returns True when the path is accessible.
 */
async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}
