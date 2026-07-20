import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Common local directories where developer CLIs are installed, used as a
 * fallback when a command is absent from the shell-derived PATH. `~` expands to
 * the user's home directory at lookup time.
 */
export const COMMON_BIN_CANDIDATE_DIRS = [
	'~/.local/bin',
	'~/bin',
	'/opt/homebrew/bin',
	'/usr/local/bin',
	'/usr/bin',
	'/bin',
] as const;

/**
 * Reports whether a path points at an existing, non-directory file with the
 * executable bit set for the current process.
 * @param candidatePath - Absolute path to test.
 * @returns True when the path is a runnable executable file.
 */
export function isExecutableFile(candidatePath: string): boolean {
	if (!existsSync(candidatePath)) {
		return false;
	}
	try {
		if (statSync(candidatePath).isDirectory()) {
			return false;
		}
		accessSync(candidatePath, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * Walks a PATH-style value looking for the first directory that holds an
 * executable named `command`.
 * @param command - Bare command name to resolve (no path separators).
 * @param pathValue - PATH-style, `path.delimiter`-separated directory list.
 * @returns The absolute path to the executable, or null when it is absent.
 */
export function findExecutableOnPath(
	command: string,
	pathValue: string,
): string | null {
	for (const directory of pathValue.split(path.delimiter)) {
		if (!directory) {
			continue;
		}
		const candidatePath = path.join(directory, command);
		if (isExecutableFile(candidatePath)) {
			return candidatePath;
		}
	}
	return null;
}

/**
 * Resolves a bare command against a set of install directories, expanding a
 * leading `~` to the home directory.
 * @param command - Bare command name to resolve.
 * @param homeDirectory - Home directory used to expand `~` (defaults to the OS home).
 * @param dirs - Directories to search (defaults to the common install dirs).
 * @returns The absolute path to the executable, or null when none match.
 */
export function findExecutableInCommonDirs(
	command: string,
	homeDirectory: string = homedir(),
	dirs: readonly string[] = COMMON_BIN_CANDIDATE_DIRS,
): string | null {
	for (const directory of dirs) {
		const expandedDir = directory.startsWith('~/')
			? path.join(homeDirectory, directory.slice(2))
			: directory;
		const candidatePath = path.join(expandedDir, command);
		if (isExecutableFile(candidatePath)) {
			return candidatePath;
		}
	}
	return null;
}
