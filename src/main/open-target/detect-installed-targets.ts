import { access, constants } from 'node:fs/promises';

import type { LocalCommandService } from '../commands';
import { isValidBundleId, OPEN_TARGET_REGISTRY } from './open-target-registry';

const MDFIND_TIMEOUT_MS = 3000;
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
 * Probes which registered targets exist on this host. macOS-only — on other
 * platforms only utilities are returned as installed.
 *
 * One `mdfind` call per bundle id, parallelised. Builtins fall back to a small
 * list of known system paths since mdfind can omit Apple-shipped apps when the
 * Spotlight index has not been built for those system volumes.
 */
export async function detectInstalledTargets({
	localCommandService,
}: {
	localCommandService: LocalCommandService;
}): Promise<DetectedTargetsMap> {
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
		return detected;
	}

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
					const path = await findFirstInstalledAppPath({
						bundleIds: definition.detection.bundleIds,
						localCommandService,
					});
					detected[definition.id] = {
						appPath: path,
						installed: path !== null,
					};
				}
			}
		}),
	);

	return detected;
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
 * @param options - Candidate bundle ids and the command runner.
 * @returns The first matching `.app` path, or null when none is installed.
 */
async function findFirstInstalledAppPath({
	bundleIds,
	localCommandService,
}: {
	bundleIds: readonly string[];
	localCommandService: LocalCommandService;
}): Promise<string | null> {
	for (const bundleId of bundleIds) {
		const path = await mdfindPathForBundleId({ bundleId, localCommandService });
		if (path) {
			return path;
		}
	}
	return null;
}

/**
 * Electron exposes `app.getApplicationInfoForProtocol` and similar APIs but no
 * direct "find by bundle id". `mdfind` is the canonical Launch Services hook;
 * this thin wrapper returns the first matching `.app` path or null.
 */
async function mdfindPathForBundleId({
	bundleId,
	localCommandService,
}: {
	bundleId: string;
	localCommandService: LocalCommandService;
}): Promise<string | null> {
	// Registry is asserted at module load, but defence in depth: anything that
	// reaches the Spotlight predicate must already be a strict reverse-DNS id,
	// so no shell/predicate escaping is required.
	if (!isValidBundleId(bundleId)) {
		return null;
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
			return null;
		}

		const firstLine = result.stdout
			.split('\n')
			.map((line) => line.trim())
			.find((line) => line.length > 0);

		return firstLine ?? null;
	} catch {
		return null;
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
