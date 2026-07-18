import { access, constants } from 'node:fs/promises';

import type { LocalCommandService } from '../commands/index.ts';
import {
	isValidBundleId,
	OPEN_TARGET_REGISTRY,
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
 * Outcome of a full detection pass. `degraded` is set when at least one
 * bundle-id target could not be resolved because its `mdfind` probe failed
 * (timeout, spawn error) rather than genuinely returning "not installed" — a
 * signal to callers that the result may be hiding installed apps and should not
 * be trusted as the authoritative installed set.
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
 * Probes which registered targets exist on this host. macOS-only — on other
 * platforms only utilities are returned as installed.
 *
 * One `mdfind` call per bundle id, parallelised. Builtins fall back to a small
 * list of known system paths since mdfind can omit Apple-shipped apps when the
 * Spotlight index has not been built for those system volumes.
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

	if (process.platform !== 'darwin') {
		for (const definition of OPEN_TARGET_REGISTRY) {
			if (definition.detection.kind === 'utility') {
				detected[definition.id] = { appPath: null, installed: true };
			}
		}
		return { degraded: false, detected };
	}

	let degraded = false;

	await Promise.all(
		OPEN_TARGET_REGISTRY.map(async (definition) => {
			switch (definition.detection.kind) {
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
				case 'bundleId': {
					const resolution = await findFirstInstalledAppPath({
						bundleIds: definition.detection.bundleIds,
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
