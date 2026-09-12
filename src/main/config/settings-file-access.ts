/**
 * Bounded reads and symlink refusals for a repository's committed
 * `.ensemblr/settings.toml`.
 *
 * The file lives inside the repository checkout, so its path components and its
 * size are both attacker-supplied. The publication writer already refused a
 * symlinked root, `.ensemblr/`, or settings file and read the file through a
 * size cap; the loader and the Scripts writer did neither. Both guarantees live
 * here so the three writers and the loader share one answer rather than three.
 */
import { closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import path from 'node:path';

import {
	ENSEMBLR_DIRECTORY,
	ENSEMBLR_SETTINGS_FILENAME,
} from './repository-config.ts';

/** Refusal surfaced when a repository has made its settings path unsafe. */
const UNSAFE_SETTINGS_PATH_MESSAGE =
	'.ensemblr/settings.toml could not be written: the repository root, .ensemblr/, or the file itself is a symlink.';

/** Largest committed settings file any reader will allocate. */
export const MAX_SETTINGS_BYTES = 1024 * 1024;

/** Why a settings path may not be read from or written to. */
export type SettingsPathRefusal = 'path-unsafe';

/** Why a bounded read did not produce bytes. */
export type BoundedReadFailure = 'too-large' | 'unreadable';

/** Outcome of a bounded settings read. */
export type BoundedReadResult =
	| { bytes: Buffer; ok: true }
	| { ok: false; reason: BoundedReadFailure };

/**
 * Absolute path of a repository's committed settings file.
 * @param repositoryPath - Absolute repository root.
 * @returns The `.ensemblr/settings.toml` path.
 */
export function settingsFilePath(repositoryPath: string): string {
	return path.join(
		repositoryPath,
		ENSEMBLR_DIRECTORY,
		ENSEMBLR_SETTINGS_FILENAME,
	);
}

/**
 * Rejects a settings path whose root, `.ensemblr/` directory, or settings file
 * is a symlink, so a committed link cannot redirect a write out of the
 * repository.
 * @param repositoryPath - Absolute repository root.
 * @returns `'path-unsafe'` when any of the three levels is unsafe, else null.
 */
export function settingsPathRefusal(
	repositoryPath: string,
): SettingsPathRefusal | null {
	const root = statEntry(repositoryPath);
	if (!root?.isDirectory() || root.isSymbolicLink()) {
		return 'path-unsafe';
	}

	const configDirectory = statEntry(
		path.join(repositoryPath, ENSEMBLR_DIRECTORY),
	);
	if (configDirectory?.isSymbolicLink()) {
		return 'path-unsafe';
	}

	const file = statEntry(settingsFilePath(repositoryPath));

	return file && (file.isSymbolicLink() || !file.isFile())
		? 'path-unsafe'
		: null;
}

/**
 * Refuses a repository whose settings path has been made unsafe, so every
 * writer touching the file fails the same way rather than each inventing a
 * check.
 * @param repositoryPath - Absolute repository root.
 * @throws When the root, `.ensemblr/`, or the settings file is a symlink.
 */
export function assertSafeSettingsPath(repositoryPath: string): void {
	if (settingsPathRefusal(repositoryPath) !== null) {
		throw new Error(UNSAFE_SETTINGS_PATH_MESSAGE);
	}
}

/**
 * Reads a file without ever allocating more than {@link MAX_SETTINGS_BYTES}, so
 * an oversized file on disk is refused rather than pulled into the main process
 * first. A file that grew past the size just measured is refused on the same
 * path, since the bytes read would be a truncated prefix.
 * @param filePath - File to read.
 * @returns The file's bytes, or why they were not produced.
 */
export function readBoundedSettingsFile(filePath: string): BoundedReadResult {
	let descriptor: number;
	try {
		descriptor = openSync(filePath, 'r');
	} catch {
		return { ok: false, reason: 'unreadable' };
	}

	try {
		const size = fstatSync(descriptor).size;
		if (size > MAX_SETTINGS_BYTES) {
			return { ok: false, reason: 'too-large' };
		}
		const capacity = size + 1;
		const buffer = Buffer.alloc(capacity);
		const read = readSync(descriptor, buffer, 0, capacity, 0);

		return read >= capacity
			? { ok: false, reason: 'too-large' }
			: { bytes: buffer.subarray(0, read), ok: true };
	} catch {
		return { ok: false, reason: 'unreadable' };
	} finally {
		closeSync(descriptor);
	}
}

/**
 * Reads one entry's link-level stats, reporting an unreadable path as absent.
 * @param target - Path to inspect without following a final symlink.
 * @returns The entry's stats, or null when it cannot be read.
 */
function statEntry(target: string): ReturnType<typeof lstatSync> | null {
	try {
		return lstatSync(target);
	} catch {
		return null;
	}
}
