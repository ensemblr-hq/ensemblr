import { access, constants } from 'node:fs/promises';

import type { LocalCommandService } from '../commands';
import { OPEN_TARGET_REGISTRY } from './open-target-registry';

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
export interface DetectedTarget {
	appPath: string | null;
	installed: boolean;
}

/** Map of registry id → detection result. */
export type DetectedTargetsMap = Readonly<Record<string, DetectedTarget>>;

interface DetectInstalledTargetsOptions {
	localCommandService: LocalCommandService;
}

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
}: DetectInstalledTargetsOptions): Promise<DetectedTargetsMap> {
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

async function resolveBuiltinAppPath(id: string): Promise<string | null> {
	const candidates = BUILTIN_APP_PATHS[id] ?? [];
	for (const candidate of candidates) {
		if (await pathExists(candidate)) {
			return candidate;
		}
	}
	return null;
}

interface FindFirstInstalledOptions {
	bundleIds: readonly string[];
	localCommandService: LocalCommandService;
}

async function findFirstInstalledAppPath({
	bundleIds,
	localCommandService,
}: FindFirstInstalledOptions): Promise<string | null> {
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
	try {
		const result = await localCommandService.run(
			{
				args: [`kMDItemCFBundleIdentifier == "${escapeBundleId(bundleId)}"`],
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

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

function escapeBundleId(id: string): string {
	return id.replace(/"/g, '\\"');
}
